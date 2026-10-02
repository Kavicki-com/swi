import { RealtimeGateway } from './realtime.gateway'
import { JwtService } from '@nestjs/jwt'
import { wsCorsOptions } from '../cors'
import type { PrismaService } from '../prisma/prisma.service'

const secret = 'test-secret-realtime'

const fakeSocket = (token?: string) => {
  const joined: string[] = []
  return {
    handshake: { auth: token ? { token } : {}, headers: {} },
    data: {} as Record<string, unknown>,
    join: (r: string) => joined.push(r),
    disconnect: jest.fn(),
    _joined: joined,
  }
}

/** Usuário que o banco devolve para o id do token; null = não existe. */
const prismaDouble = (user: { active: boolean } | null = { active: true }) => ({
  user: { findUnique: jest.fn().mockResolvedValue(user) },
})

describe('RealtimeGateway', () => {
  const jwt = new JwtService({ secret })
  let g: RealtimeGateway
  let prisma: ReturnType<typeof prismaDouble>
  beforeAll(() => { process.env.JWT_SECRET = secret })
  beforeEach(() => {
    prisma = prismaDouble()
    g = new RealtimeGateway(jwt, prisma as unknown as PrismaService)
  })

  it('connect com token válido entra na sala user:<sub>', async () => {
    const token = jwt.sign({ sub: 'u1', role: 'WORKER' })
    const c = fakeSocket(token) as any
    await g.handleConnection(c)
    expect(c.data.userId).toBe('u1')
    expect(c._joined).toContain('user:u1')
    expect(c.disconnect).not.toHaveBeenCalled()
  })

  it('CORS do WS alinhado ao corsOrigins do HTTP (fim do origin *)', () => {
    // Mesma env que rege o enableCors do REST (PR #41). Cliente RN não manda
    // header Origin no handshake, então restringir não afeta o mobile.
    const opts = Reflect.getMetadata('websockets:gateway_options', RealtimeGateway)
    expect(opts?.cors?.origin).not.toBe('*')
    expect(opts?.cors).toEqual(wsCorsOptions(process.env))
  })

  it('connect sem/ com token inválido desconecta', async () => {
    const c = fakeSocket('lixo') as any
    await g.handleConnection(c)
    expect(c.disconnect).toHaveBeenCalled()
    const c2 = fakeSocket(undefined) as any
    await g.handleConnection(c2)
    expect(c2.disconnect).toHaveBeenCalled()
  })

  // O token vale por dias; sem esta conferência, um usuário desativado seguiria
  // recebendo chat, notificação e telemetria até o token vencer.
  it('usuário desativado desconecta e não entra em sala nenhuma', async () => {
    prisma.user.findUnique.mockResolvedValue({ active: false })
    const c = fakeSocket(jwt.sign({ sub: 'u1', role: 'ADMIN' })) as any
    await g.handleConnection(c)
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { active: true } })
    expect(c.disconnect).toHaveBeenCalled()
    expect(c._joined).toEqual([])
  })

  it('usuário que não existe mais desconecta', async () => {
    prisma.user.findUnique.mockResolvedValue(null)
    const c = fakeSocket(jwt.sign({ sub: 'apagado', role: 'WORKER' })) as any
    await g.handleConnection(c)
    expect(c.disconnect).toHaveBeenCalled()
    expect(c._joined).toEqual([])
  })

  // Sem conseguir conferir, a conexão não abre: ela some, o cliente tenta de
  // novo, e o REST continua respondendo com a própria checagem.
  it('falha na conferência do usuário desconecta em vez de deixar entrar', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('banco fora'))
    const c = fakeSocket(jwt.sign({ sub: 'u1', role: 'WORKER' })) as any
    await g.handleConnection(c)
    expect(c.disconnect).toHaveBeenCalled()
    expect(c._joined).toEqual([])
  })

  it('emitToUsers emite o evento nas salas de cada participante', () => {
    const emit = jest.fn()
    const to = jest.fn(() => ({ emit }))
    ;(g as any).server = { to }
    g.emitToUsers(['a', 'b'], 'message', { id: 'm1' })
    expect(to).toHaveBeenCalledWith('user:a')
    expect(to).toHaveBeenCalledWith('user:b')
    expect(emit).toHaveBeenCalledWith('message', { id: 'm1' })
    expect(emit).toHaveBeenCalledTimes(2)
  })
})
