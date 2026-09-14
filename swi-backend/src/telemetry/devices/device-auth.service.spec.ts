import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { hash } from '../../auth/codes'
import type { PrismaService } from '../../prisma/prisma.service'
import { DeviceAuthService, ENROLLMENT_TTL_MIN, hashCredential } from './device-auth.service'

// O que estes casos protegem é a fronteira de identidade do piloto: quem pode
// parear, por quanto tempo, uma vez só, e de quem é o funcionário que a
// telemetria vai gravar. Prisma é dublê aqui de propósito; o que precisa de
// banco real é a idempotência, provada no e2e do repositório.

const CODE = '123456'
const ADMIN = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }

const prismaDouble = () =>
  ({
    user: { findUnique: jest.fn() },
    telemetryEnrollment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    telemetryDevice: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  }) as any

const service = (prisma: any) => new DeviceAuthService(prisma as PrismaService)

const worker = (over: Record<string, unknown> = {}) => ({
  id: 'worker-1',
  companyId: 'company-1',
  role: 'WORKER',
  ...over,
})

const enrollment = async (over: Record<string, unknown> = {}) => ({
  id: 'enrollment-1',
  workerId: 'worker-1',
  kind: 'IPHONE',
  codeHash: await hash(CODE),
  expiresAt: new Date(Date.now() + 5 * 60_000),
  consumedAt: null,
  ...over,
})

describe('DeviceAuthService.createEnrollment', () => {
  it('gera código de seis dígitos com validade curta e guarda somente o hash', async () => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockResolvedValue(worker())
    prisma.telemetryEnrollment.create.mockImplementation(({ data }: any) => ({ id: 'e1', ...data }))

    const before = Date.now()
    const result = await service(prisma).createEnrollment(ADMIN, {
      workerId: 'worker-1',
      kind: 'IPHONE',
    })
    const after = Date.now()

    expect(result.code).toMatch(/^\d{6}$/)
    // Janela e não igualdade: o serviço lê o próprio relógio, que anda entre a
    // captura daqui e a de lá.
    expect(result.expiresAt.getTime()).toBeGreaterThan(before)
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + ENROLLMENT_TTL_MIN * 60_000)

    const { data } = prisma.telemetryEnrollment.create.mock.calls[0][0]
    expect(data.workerId).toBe('worker-1')
    expect(data.createdById).toBe('admin-1')
    // O código em claro sai na resposta uma vez e nunca entra no banco.
    expect(JSON.stringify(data)).not.toContain(result.code)
    expect(data.codeHash).not.toBe(result.code)
  })

  it('recusa parear funcionário de outra empresa sem confirmar que ele existe', async () => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockResolvedValue(worker({ companyId: 'outra-empresa' }))

    const erro = await service(prisma)
      .createEnrollment(ADMIN, { workerId: 'worker-1', kind: 'IPHONE' })
      .catch((e: Error) => e)

    // Mesma resposta de "não existe", como no resto do backend: fora do escopo
    // e inexistente não podem ser distinguíveis de fora.
    expect(erro).toBeInstanceOf(NotFoundException)
    expect((erro as Error).message).toBe('Funcionário não encontrado')
    expect(prisma.telemetryEnrollment.create).not.toHaveBeenCalled()
  })

  it('recusa administrador sem empresa, em vez de casar dois nulos', async () => {
    const prisma = prismaDouble()

    await expect(
      service(prisma).createEnrollment(
        { ...ADMIN, companyId: null },
        { workerId: 'worker-1', kind: 'IPHONE' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('recusa emitir credencial para o relógio, que se associa pelo companion', async () => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockResolvedValue(worker())

    await expect(
      service(prisma).createEnrollment(ADMIN, {
        workerId: 'worker-1',
        kind: 'APPLE_WATCH' as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.telemetryEnrollment.create).not.toHaveBeenCalled()
  })
})

describe('DeviceAuthService.completeEnrollment', () => {
  const withTransaction = (prisma: any) => {
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma))
    prisma.telemetryDevice.create.mockImplementation(({ data }: any) => ({
      id: 'device-1',
      ...data,
    }))
  }

  it('devolve a credencial uma única vez e guarda somente o hash dela', async () => {
    const prisma = prismaDouble()
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(await enrollment())
    withTransaction(prisma)

    const result = await service(prisma).completeEnrollment('worker-1', {
      enrollmentId: 'enrollment-1',
      code: CODE,
      model: 'iPhone 15',
    })

    expect(result.deviceId).toBe('device-1')
    // Formato <deviceId>.<segredo>: o guard identifica o dispositivo sem
    // precisar procurar por hash no banco inteiro.
    const [deviceId, secret] = result.credential.split('.')
    expect(deviceId).toBe('device-1')
    expect(secret).toHaveLength(64)

    const { data } = prisma.telemetryDevice.create.mock.calls[0][0]
    expect(data.credentialHash).toBe(hashCredential(secret))
    expect(JSON.stringify(data)).not.toContain(secret)
    expect(data.workerId).toBe('worker-1')
  })

  it('consome o enrollment, tornando o código de uso único', async () => {
    const prisma = prismaDouble()
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(await enrollment())
    withTransaction(prisma)

    await service(prisma).completeEnrollment('worker-1', {
      enrollmentId: 'enrollment-1',
      code: CODE,
    })

    const { where, data } = prisma.telemetryEnrollment.update.mock.calls[0][0]
    expect(where).toEqual({ id: 'enrollment-1', consumedAt: null })
    expect(data.consumedAt).toBeInstanceOf(Date)
  })

  it('revoga o aparelho anterior do mesmo tipo ao concluir um novo pareamento', async () => {
    const prisma = prismaDouble()
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(await enrollment())
    withTransaction(prisma)

    await service(prisma).completeEnrollment('worker-1', {
      enrollmentId: 'enrollment-1',
      code: CODE,
    })

    // Trocar de iPhone não pode deixar a credencial antiga viva: o funcionário
    // tem um aparelho ativo por tipo, e o painel não mostra dois "ativos".
    const { where, data } = prisma.telemetryDevice.updateMany.mock.calls[0][0]
    expect(where).toEqual({ workerId: 'worker-1', kind: 'IPHONE', revokedAt: null })
    expect(data.revokedAt).toBeInstanceOf(Date)
    // A revogação vem antes da criação, senão o aparelho novo se auto-revoga.
    expect(prisma.telemetryDevice.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.telemetryDevice.create.mock.invocationCallOrder[0],
    )
  })

  it('recusa um enrollment já consumido', async () => {
    const prisma = prismaDouble()
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(
      await enrollment({ consumedAt: new Date() }),
    )

    await expect(
      service(prisma).completeEnrollment('worker-1', { enrollmentId: 'enrollment-1', code: CODE }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.telemetryDevice.create).not.toHaveBeenCalled()
  })

  it('traduz a corrida perdida do uso único em recusa, não em erro interno', async () => {
    const prisma = prismaDouble()
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(await enrollment())
    // Quem perde o update condicional recebe P2025 do Prisma. Sem tradução,
    // isso sairia como 500 e o aparelho concluiria que o servidor caiu.
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('registro não encontrado', {
        code: 'P2025',
        clientVersion: '5.22.0',
      }),
    )

    await expect(
      service(prisma).completeEnrollment('worker-1', { enrollmentId: 'enrollment-1', code: CODE }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('recusa um código expirado', async () => {
    const prisma = prismaDouble()
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(
      await enrollment({ expiresAt: new Date(Date.now() - 1_000) }),
    )

    await expect(
      service(prisma).completeEnrollment('worker-1', { enrollmentId: 'enrollment-1', code: CODE }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.telemetryDevice.create).not.toHaveBeenCalled()
  })

  it('recusa um código errado sem repetir o código na mensagem', async () => {
    const prisma = prismaDouble()
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(await enrollment())

    const erro = await service(prisma)
      .completeEnrollment('worker-1', { enrollmentId: 'enrollment-1', code: '999999' })
      .catch((e: Error) => e)

    expect(erro).toBeInstanceOf(BadRequestException)
    expect((erro as Error).message).not.toContain('999999')
    expect(prisma.telemetryDevice.create).not.toHaveBeenCalled()
  })

  it('recusa o enrollment de outro funcionário como se ele não existisse', async () => {
    const prisma = prismaDouble()
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(await enrollment())

    const alheio = await service(prisma)
      .completeEnrollment('worker-2', { enrollmentId: 'enrollment-1', code: CODE })
      .catch((e: Error) => e)
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(null)
    const inexistente = await service(prisma)
      .completeEnrollment('worker-2', { enrollmentId: 'nao-existe', code: CODE })
      .catch((e: Error) => e)

    // Mesma classe e mesma mensagem: sondar ids não revela quais existem.
    expect(alheio).toBeInstanceOf(BadRequestException)
    expect((alheio as Error).message).toBe((inexistente as Error).message)
    expect(prisma.telemetryDevice.create).not.toHaveBeenCalled()
  })

  it('ignora workerId vindo do corpo: o vínculo é o do enrollment', async () => {
    const prisma = prismaDouble()
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(await enrollment())
    withTransaction(prisma)

    await service(prisma).completeEnrollment('worker-1', {
      enrollmentId: 'enrollment-1',
      code: CODE,
      workerId: 'worker-invasor',
    } as never)

    expect(prisma.telemetryDevice.create.mock.calls[0][0].data.workerId).toBe('worker-1')
  })
})

describe('DeviceAuthService.authenticate', () => {
  const secret = 'a'.repeat(64)
  const device = (over: Record<string, unknown> = {}) => ({
    id: 'device-1',
    workerId: 'worker-1',
    credentialHash: hashCredential(secret),
    revokedAt: null,
    ...over,
  })

  it('deriva o funcionário da credencial, não do que o cliente diz ser', async () => {
    const prisma = prismaDouble()
    prisma.telemetryDevice.findUnique.mockResolvedValue(device())

    const identity = await service(prisma).authenticate(`Device device-1.${secret}`)

    expect(identity).toEqual({ deviceId: 'device-1', workerId: 'worker-1' })
  })

  it('marca o último contato do dispositivo', async () => {
    const prisma = prismaDouble()
    prisma.telemetryDevice.findUnique.mockResolvedValue(device())

    await service(prisma).authenticate(`Device device-1.${secret}`)

    expect(prisma.telemetryDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'device-1' } }),
    )
  })

  it('recusa credencial errada sem repetir o segredo na mensagem', async () => {
    const prisma = prismaDouble()
    prisma.telemetryDevice.findUnique.mockResolvedValue(device())
    const errado = 'b'.repeat(64)

    const erro = await service(prisma)
      .authenticate(`Device device-1.${errado}`)
      .catch((e: Error) => e)

    expect(erro).toBeInstanceOf(UnauthorizedException)
    expect((erro as Error).message).not.toContain(errado)
  })

  it('recusa dispositivo revogado, sem esperar o token expirar', async () => {
    const prisma = prismaDouble()
    prisma.telemetryDevice.findUnique.mockResolvedValue(device({ revokedAt: new Date() }))

    await expect(service(prisma).authenticate(`Device device-1.${secret}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it.each([undefined, '', 'Bearer token-jwt', 'Device sem-ponto', 'Device .so-segredo'])(
    'recusa cabeçalho ausente ou malformado: %p',
    async (header) => {
      const prisma = prismaDouble()

      await expect(service(prisma).authenticate(header)).rejects.toBeInstanceOf(
        UnauthorizedException,
      )
      expect(prisma.telemetryDevice.findUnique).not.toHaveBeenCalled()
    },
  )

  it('recusa dispositivo inexistente sem revelar que ele não existe', async () => {
    const prisma = prismaDouble()
    prisma.telemetryDevice.findUnique.mockResolvedValue(null)

    const erro = await service(prisma)
      .authenticate(`Device device-fantasma.${secret}`)
      .catch((e: Error) => e)

    expect(erro).toBeInstanceOf(UnauthorizedException)
    // Mesma mensagem do caso de segredo errado: quem sonda não aprende nada.
    expect((erro as Error).message).toBe('Credencial de dispositivo inválida')
  })
})

describe('DeviceAuthService.revoke', () => {
  it('revoga o dispositivo dentro do escopo do administrador', async () => {
    const prisma = prismaDouble()
    prisma.telemetryDevice.updateMany.mockResolvedValue({ count: 1 })

    await service(prisma).revoke(ADMIN, 'device-1')

    const { where, data } = prisma.telemetryDevice.updateMany.mock.calls[0][0]
    expect(where.id).toBe('device-1')
    expect(where.worker).toEqual({ companyId: 'company-1' })
    expect(data.revokedAt).toBeInstanceOf(Date)
  })

  it('recusa revogar dispositivo de outra empresa como se ele não existisse', async () => {
    const prisma = prismaDouble()
    prisma.telemetryDevice.updateMany.mockResolvedValue({ count: 0 })

    const erro = await service(prisma)
      .revoke(ADMIN, 'device-alheio')
      .catch((e: Error) => e)

    expect(erro).toBeInstanceOf(NotFoundException)
    expect((erro as Error).message).toBe('Dispositivo não encontrado')
  })

  it('recusa administrador sem empresa antes de tocar o banco', async () => {
    const prisma = prismaDouble()

    await expect(
      service(prisma).revoke({ ...ADMIN, companyId: null }, 'device-1'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.telemetryDevice.updateMany).not.toHaveBeenCalled()
  })
})

// O painel precisa saber o estado ANTES de agir: não pareado, código válido
// aguardando o funcionário, ou pareado desde quando. É a única leitura de
// aparelho do backend, e por isso é escopada pela empresa como as escritas.
describe('DeviceAuthService.deviceStateForAdmin', () => {
  const PAIRED_AT = new Date('2026-09-14T12:00:00.000Z')
  const SEEN_AT = new Date('2026-09-14T15:30:00.000Z')

  it('devolve o aparelho ativo, com quando foi pareado e o último contato', async () => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockResolvedValue(worker())
    prisma.telemetryDevice.findFirst.mockResolvedValue({
      id: 'device-1',
      kind: 'IPHONE',
      model: 'iPhone 15',
      createdAt: PAIRED_AT,
      lastSeenAt: SEEN_AT,
    })

    const state = await service(prisma).deviceStateForAdmin(ADMIN, 'worker-1')

    expect(state).toEqual({
      device: { id: 'device-1', kind: 'IPHONE', model: 'iPhone 15', pairedAt: PAIRED_AT, lastSeenAt: SEEN_AT },
      pendingEnrollment: null,
    })
    // Só o ativo interessa: um revogado não é aparelho pareado.
    const { where } = prisma.telemetryDevice.findFirst.mock.calls[0][0]
    expect(where).toEqual({ workerId: 'worker-1', revokedAt: null })
  })

  it('sem aparelho ativo, diz se há um código ainda válido aguardando o funcionário', async () => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockResolvedValue(worker())
    const expiresAt = new Date(Date.now() + 4 * 60_000)
    prisma.telemetryEnrollment.findFirst.mockResolvedValue({ expiresAt })

    const state = await service(prisma).deviceStateForAdmin(ADMIN, 'worker-1')

    expect(state).toEqual({ device: null, pendingEnrollment: { expiresAt } })
    // Pendente é o que ainda pode ser concluído: não consumido e não expirado.
    const { where } = prisma.telemetryEnrollment.findFirst.mock.calls[0][0]
    expect(where.workerId).toBe('worker-1')
    expect(where.consumedAt).toBeNull()
    expect(where.expiresAt.gt).toBeInstanceOf(Date)
  })

  it('sem aparelho e sem código válido, os dois vêm nulos', async () => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockResolvedValue(worker())

    expect(await service(prisma).deviceStateForAdmin(ADMIN, 'worker-1')).toEqual({
      device: null,
      pendingEnrollment: null,
    })
  })

  it('funcionário de outra empresa responde como inexistente, sem consultar aparelho', async () => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockResolvedValue(worker({ companyId: 'company-2' }))

    const erro = await service(prisma)
      .deviceStateForAdmin(ADMIN, 'worker-1')
      .catch((e: Error) => e)

    expect(erro).toBeInstanceOf(NotFoundException)
    expect((erro as Error).message).toBe('Funcionário não encontrado')
    expect(prisma.telemetryDevice.findFirst).not.toHaveBeenCalled()
    expect(prisma.telemetryEnrollment.findFirst).not.toHaveBeenCalled()
  })

  it('recusa administrador sem empresa antes de tocar o banco', async () => {
    const prisma = prismaDouble()

    await expect(
      service(prisma).deviceStateForAdmin({ ...ADMIN, companyId: null }, 'worker-1'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
})

// O app decide a frase pelo `code`, não pelo texto: uma vírgula corrigida na
// mensagem não pode mudar o conselho ao funcionário. `message` fica no corpo
// para o app de hoje, que ainda casa por texto, não quebrar no intervalo.
describe('DeviceAuthService, códigos de recusa do pareamento', () => {
  const rejectionOf = async (promise: Promise<unknown>) => {
    const erro = await promise.catch((e: BadRequestException) => e)
    expect(erro).toBeInstanceOf(BadRequestException)
    return (erro as BadRequestException).getResponse() as Record<string, unknown>
  }

  it('código expirado', async () => {
    const prisma = prismaDouble()
    prisma.telemetryEnrollment.findUnique.mockResolvedValue(
      await enrollment({ expiresAt: new Date(Date.now() - 1_000) }),
    )
    const body = await rejectionOf(
      service(prisma).completeEnrollment('worker-1', { enrollmentId: 'enrollment-1', code: CODE }),
    )
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'ENROLLMENT_EXPIRED',
      message: 'Código de pareamento expirado',
    })
  })

  it('código já utilizado, pelo consumedAt e pela corrida perdida', async () => {
    const consumido = prismaDouble()
    consumido.telemetryEnrollment.findUnique.mockResolvedValue(
      await enrollment({ consumedAt: new Date() }),
    )
    const corrida = prismaDouble()
    corrida.telemetryEnrollment.findUnique.mockResolvedValue(await enrollment())
    corrida.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('registro não encontrado', {
        code: 'P2025',
        clientVersion: '5.22.0',
      }),
    )
    for (const prisma of [consumido, corrida]) {
      const body = await rejectionOf(
        service(prisma).completeEnrollment('worker-1', { enrollmentId: 'enrollment-1', code: CODE }),
      )
      expect(body).toMatchObject({ code: 'ENROLLMENT_USED', message: 'Código de pareamento já utilizado' })
    }
  })

  it('inválido: código errado, de outro funcionário e inexistente dão o MESMO corpo', async () => {
    // Sondar identificadores não pode revelar quais existem nem de quem são.
    const errado = prismaDouble()
    errado.telemetryEnrollment.findUnique.mockResolvedValue(await enrollment())
    const alheio = prismaDouble()
    alheio.telemetryEnrollment.findUnique.mockResolvedValue(await enrollment())
    const inexistente = prismaDouble()
    inexistente.telemetryEnrollment.findUnique.mockResolvedValue(null)

    const bodies = await Promise.all([
      rejectionOf(service(errado).completeEnrollment('worker-1', { enrollmentId: 'enrollment-1', code: '999999' })),
      rejectionOf(service(alheio).completeEnrollment('worker-2', { enrollmentId: 'enrollment-1', code: CODE })),
      rejectionOf(service(inexistente).completeEnrollment('worker-2', { enrollmentId: 'nao-existe', code: CODE })),
    ])
    for (const body of bodies) {
      expect(body).toMatchObject({ code: 'ENROLLMENT_INVALID', message: 'Código de pareamento inválido' })
    }
    expect(bodies[0]).toEqual(bodies[1])
    expect(bodies[1]).toEqual(bodies[2])
  })

  it('tipo de aparelho que não recebe credencial', async () => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockResolvedValue(worker())
    const body = await rejectionOf(
      service(prisma).createEnrollment(ADMIN, { workerId: 'worker-1', kind: 'APPLE_WATCH' as never }),
    )
    expect(body).toMatchObject({
      code: 'ENROLLMENT_UNSUPPORTED_DEVICE',
      message: 'Este tipo de aparelho não recebe credencial própria',
    })
  })
})
