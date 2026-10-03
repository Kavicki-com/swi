import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { requireJwtSecret } from '../src/auth/jwt-secret'
import { PrismaService } from '../src/prisma/prisma.service'
import { EXPIRED_CODE_GRACE_MIN } from '../src/telemetry/devices/device-auth.service'

// E2E do pareamento pela rota, com o corpo que o app manda: só o código que o
// administrador dita, sem o id do convite. O que o unitário não alcança mora
// aqui: o DTO de verdade sob o ValidationPipe global, e a busca por código
// filtrando no Postgres por funcionário, consumo e validade.
//
// CNPJ exclusivo deste spec. Reusar o do seed apagaria a empresa demo e
// desvincularia os usuários dela, porque User.companyId é opcional e o Prisma
// aplica SetNull.
const CNPJ = '99000000000305'

describe('Telemetry enrollment e2e', () => {
  let app: INestApplication
  let prisma: PrismaService

  const emails = {
    admin: `telemetry-enroll-admin-${randomUUID()}@ex.com`,
    a: `telemetry-enroll-a-${randomUUID()}@ex.com`,
    b: `telemetry-enroll-b-${randomUUID()}@ex.com`,
  }
  let adminId = ''
  let workerA = ''
  let workerB = ''

  // Assina com o mesmo segredo que a estratégia JWT confere; o papel vem do
  // banco a cada requisição, então o token só identifica a pessoa.
  const bearer = (sub: string, role: string) => ({
    Authorization: `Bearer ${new JwtService({ secret: requireJwtSecret() }).sign({ sub, role })}`,
  })

  const convidar = async (workerId: string) => {
    const { body } = await request(app.getHttpServer())
      .post('/telemetry/v1/devices/enrollments')
      .set(bearer(adminId, 'ADMIN'))
      .send({ workerId, kind: 'IPHONE' })
      .expect(201)
    return body as { enrollmentId: string; code: string }
  }

  const concluir = (workerId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/telemetry/v1/devices/enrollments/complete')
      .set(bearer(workerId, 'WORKER'))
      .send(body)

  /** Um código de seis dígitos que com certeza não é o do convite. */
  const errado = (code: string) => (code === '000000' ? '111111' : '000000')

  const cleanup = async () => {
    // Cascade a partir do User leva convites e aparelhos.
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)

    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyId = (await prisma.company.create({ data: { name: 'Enroll Co', cnpj: CNPJ, ...endereco } })).id

    const user = async (email: string, role: 'ADMIN' | 'WORKER') =>
      (
        await prisma.user.create({
          data: {
            email,
            name: email,
            passwordHash: 'nao-usado-neste-spec',
            role,
            emailVerified: true,
            approvalStatus: 'APPROVED',
            companyId,
          },
        })
      ).id

    adminId = await user(emails.admin, 'ADMIN')
    workerA = await user(emails.a, 'WORKER')
    workerB = await user(emails.b, 'WORKER')
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it('só com o código, o funcionário dono do convite pareia, uma vez só', async () => {
    const { enrollmentId, code } = await convidar(workerA)

    const { body } = await concluir(workerA, { code, model: 'iPhone 15' }).expect(200)

    expect(body.workerId).toBe(workerA)
    expect(body.credential.startsWith(`${body.deviceId}.`)).toBe(true)
    const device = await prisma.telemetryDevice.findUniqueOrThrow({ where: { id: body.deviceId } })
    expect(device).toMatchObject({ workerId: workerA, kind: 'IPHONE', model: 'iPhone 15', revokedAt: null })
    const convite = await prisma.telemetryEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })
    expect(convite.consumedAt).not.toBeNull()

    // Consumido sai da busca: o mesmo código de novo é só inválido.
    const repetido = await concluir(workerA, { code }).expect(400)
    expect(repetido.body).toMatchObject({ code: 'ENROLLMENT_INVALID', message: 'Código de pareamento inválido' })
  })

  it('código errado dá ENROLLMENT_INVALID e não consome o convite', async () => {
    const { enrollmentId, code } = await convidar(workerA)

    const { body } = await concluir(workerA, { code: errado(code) }).expect(400)

    expect(body).toMatchObject({ code: 'ENROLLMENT_INVALID', message: 'Código de pareamento inválido' })
    const convite = await prisma.telemetryEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })
    expect(convite.consumedAt).toBeNull()
  })

  it('convite de outro funcionário nunca é aceito, mesmo com o código certo', async () => {
    const { enrollmentId, code } = await convidar(workerA)

    // O workerId no corpo é descartado pela whitelist: quem conta é o token.
    const { body } = await concluir(workerB, { code, workerId: workerA }).expect(400)

    expect(body).toMatchObject({ code: 'ENROLLMENT_INVALID' })
    const convite = await prisma.telemetryEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })
    expect(convite.consumedAt).toBeNull()
    expect(await prisma.telemetryDevice.count({ where: { workerId: workerB } })).toBe(0)
  })

  it('convite vencido há pouco diz expirado a quem tem o código, e inválido a quem chuta', async () => {
    const { enrollmentId, code } = await convidar(workerB)
    await prisma.telemetryEnrollment.update({
      where: { id: enrollmentId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })

    const certo = await concluir(workerB, { code }).expect(400)
    const chute = await concluir(workerB, { code: errado(code) }).expect(400)

    expect(certo.body).toMatchObject({ code: 'ENROLLMENT_EXPIRED', message: 'Código de pareamento expirado' })
    expect(chute.body).toMatchObject({ code: 'ENROLLMENT_INVALID' })

    // Fora da janela de cortesia, o vencido nem entra na busca.
    await prisma.telemetryEnrollment.update({
      where: { id: enrollmentId },
      data: { expiresAt: new Date(Date.now() - (EXPIRED_CODE_GRACE_MIN + 1) * 60_000) },
    })
    const antigo = await concluir(workerB, { code }).expect(400)
    expect(antigo.body).toMatchObject({ code: 'ENROLLMENT_INVALID' })
    expect(await prisma.telemetryDevice.count({ where: { workerId: workerB } })).toBe(0)
  })

  it('com enrollmentId, o contrato de antes continua valendo', async () => {
    const { enrollmentId, code } = await convidar(workerB)

    const { body } = await concluir(workerB, { enrollmentId, code }).expect(200)

    expect(body.workerId).toBe(workerB)
    const usado = await concluir(workerB, { enrollmentId, code }).expect(400)
    expect(usado.body).toMatchObject({ code: 'ENROLLMENT_USED' })
  })
})
