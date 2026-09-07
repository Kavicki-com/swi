import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { Prisma, TelemetryDeviceKind } from '@prisma/client'
import { generateCode, hash, verifyHash } from '../../auth/codes'
import type { JwtUser } from '../../auth/current-user.decorator'
import { PrismaService } from '../../prisma/prisma.service'

// Fronteira de identidade da telemetria. O administrador convida, o funcionário
// conclui no próprio aparelho, e a partir daí é a credencial do dispositivo que
// responde por quem está medindo. A senha do funcionário nunca entra nesse
// caminho, e por isso revogar um aparelho não mexe na conta dele.

/** Curto de propósito: o código é ditado, então a janela é a defesa principal. */
export const ENROLLMENT_TTL_MIN = 10

/**
 * O relógio não está aqui de propósito: ele não recebe credencial do backend e
 * se associa ao companion durante a sessão espelhada. Emitir credencial para o
 * Watch criaria um segundo segredo que ninguém precisa guardar.
 */
export const ENROLLABLE_KINDS = [
  TelemetryDeviceKind.IPHONE,
  TelemetryDeviceKind.EXTERNAL_CUFF,
] as const

export type EnrollableKind = (typeof ENROLLABLE_KINDS)[number]

export interface DeviceIdentity {
  deviceId: string
  workerId: string
}

export interface CreateEnrollmentInput {
  workerId: string
  kind: EnrollableKind
}

export interface CompleteEnrollmentInput {
  enrollmentId: string
  code: string
  model?: string
}

/**
 * sha256 e não bcrypt, de propósito. A credencial do dispositivo tem 256 bits
 * sorteados, então não existe dicionário a percorrer e o hash lento só custaria
 * centenas de milissegundos em cada evento de telemetria. bcrypt fica para o
 * código de seis dígitos, que é digitado por gente e tem entropia baixa.
 */
export function hashCredential(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** Mesma mensagem para todo caminho de recusa: quem sonda não aprende nada. */
const INVALID_CREDENTIAL = 'Credencial de dispositivo inválida'
/** Também única: enrollment inexistente e de outra pessoa respondem igual. */
const INVALID_CODE = 'Código de pareamento inválido'

const DEVICE_SCHEME = 'Device '

// O formato da credencial é conhecido só por estas duas funções. O deviceId vem
// junto para o guard achar a linha sem varrer hash do banco inteiro.
export function encodeCredential(deviceId: string, secret: string): string {
  return `${deviceId}.${secret}`
}

export function decodeCredential(
  header: string | undefined,
): { deviceId: string; secret: string } | null {
  if (header === undefined || !header.startsWith(DEVICE_SCHEME)) return null
  const raw = header.slice(DEVICE_SCHEME.length)
  const separator = raw.indexOf('.')
  if (separator <= 0 || separator === raw.length - 1) return null
  return { deviceId: raw.slice(0, separator), secret: raw.slice(separator + 1) }
}

function digestsMatch(stored: string, offered: string): boolean {
  const a = Buffer.from(stored, 'utf8')
  const b = Buffer.from(offered, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Empresa do administrador, ou a mesma recusa que um recurso inexistente. Nula
 * dos dois lados não é "mesma empresa": sem este teste, um administrador sem
 * vínculo alcançaria qualquer conta órfã.
 */
function companyScopeOf(admin: JwtUser, notFound: string): string {
  if (admin.companyId === null) throw new NotFoundException(notFound)
  return admin.companyId
}

function isMissingRecord(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
}

@Injectable()
export class DeviceAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async createEnrollment(admin: JwtUser, input: CreateEnrollmentInput) {
    const companyId = companyScopeOf(admin, 'Funcionário não encontrado')
    if (!ENROLLABLE_KINDS.includes(input.kind)) {
      throw new BadRequestException('Este tipo de aparelho não recebe credencial própria')
    }

    const worker = await this.prisma.user.findUnique({
      where: { id: input.workerId },
      select: { id: true, companyId: true },
    })
    // Fora do escopo responde igual a inexistente, como no resto do backend.
    if (worker === null || worker.companyId !== companyId) {
      throw new NotFoundException('Funcionário não encontrado')
    }

    const code = generateCode()
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MIN * 60_000)
    const created = await this.prisma.telemetryEnrollment.create({
      data: {
        workerId: worker.id,
        createdById: admin.userId,
        kind: input.kind,
        codeHash: await hash(code),
        expiresAt,
      },
    })

    // O código em claro existe só neste retorno. O banco guarda o hash.
    return { enrollmentId: created.id, code, expiresAt }
  }

  async completeEnrollment(workerId: string, input: CompleteEnrollmentInput) {
    const enrollment = await this.prisma.telemetryEnrollment.findUnique({
      where: { id: input.enrollmentId },
    })
    // Inexistente e de outro funcionário dão a mesma resposta: sondar
    // identificadores não pode revelar quais existem.
    if (enrollment === null || enrollment.workerId !== workerId) {
      throw new BadRequestException(INVALID_CODE)
    }
    if (enrollment.consumedAt !== null) {
      throw new BadRequestException('Código de pareamento já utilizado')
    }
    if (enrollment.expiresAt < new Date()) {
      throw new BadRequestException('Código de pareamento expirado')
    }
    if (!(await verifyHash(input.code, enrollment.codeHash))) {
      // A mensagem não repete o código tentado: resposta de erro e log são
      // lugares onde segredo vaza sem ninguém notar.
      throw new BadRequestException(INVALID_CODE)
    }

    const secret = randomBytes(32).toString('hex')
    let device
    try {
      device = await this.prisma.$transaction(async (tx) => {
        // Consumir antes de criar: numa corrida entre dois aparelhos, quem
        // perde o update não chega a ganhar dispositivo nenhum.
        await tx.telemetryEnrollment.update({
          where: { id: enrollment.id, consumedAt: null },
          data: { consumedAt: new Date() },
        })
        // Trocar de aparelho não pode deixar a credencial antiga viva. Antes de
        // criar, senão o novo entraria na própria varredura.
        await tx.telemetryDevice.updateMany({
          where: { workerId: enrollment.workerId, kind: enrollment.kind, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        return tx.telemetryDevice.create({
          data: {
            // Do enrollment, nunca do corpo da requisição.
            workerId: enrollment.workerId,
            kind: enrollment.kind,
            model: input.model ?? null,
            credentialHash: hashCredential(secret),
          },
        })
      })
    } catch (error) {
      // P2025 aqui só acontece quando o update condicional não achou linha, ou
      // seja, outro aparelho consumiu o código primeiro. Isso é recusa do
      // cliente, não falha do servidor.
      if (isMissingRecord(error)) {
        throw new BadRequestException('Código de pareamento já utilizado')
      }
      throw error
    }

    // Única vez em que a credencial existe em claro. O iPhone guarda no
    // Keychain; se perder, o caminho é revogar e parear de novo.
    return {
      deviceId: device.id,
      workerId: enrollment.workerId,
      credential: encodeCredential(device.id, secret),
    }
  }

  async authenticate(header: string | undefined): Promise<DeviceIdentity> {
    const credential = decodeCredential(header)
    if (credential === null) throw new UnauthorizedException(INVALID_CREDENTIAL)

    const device = await this.prisma.telemetryDevice.findUnique({
      where: { id: credential.deviceId },
      select: { id: true, workerId: true, credentialHash: true, revokedAt: true },
    })
    // Revogação vale na hora: não há token com validade própria para esperar.
    if (device === null || device.revokedAt !== null) {
      throw new UnauthorizedException(INVALID_CREDENTIAL)
    }
    if (!digestsMatch(device.credentialHash, hashCredential(credential.secret))) {
      throw new UnauthorizedException(INVALID_CREDENTIAL)
    }

    await this.prisma.telemetryDevice.updateMany({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    })

    // O funcionário sai daqui, do vínculo do aparelho, e não do que o cliente
    // afirma ser. É esta linha que sustenta a regra do evento sem workerId.
    return { deviceId: device.id, workerId: device.workerId }
  }

  async revoke(admin: JwtUser, deviceId: string): Promise<void> {
    const companyId = companyScopeOf(admin, 'Dispositivo não encontrado')
    const { count } = await this.prisma.telemetryDevice.updateMany({
      where: { id: deviceId, worker: { companyId } },
      data: { revokedAt: new Date() },
    })
    if (count === 0) throw new NotFoundException('Dispositivo não encontrado')
  }
}
