import { RealtimeGateway } from './realtime.gateway'
import { JwtService } from '@nestjs/jwt'
import { wsCorsOptions } from '../cors'

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

describe('RealtimeGateway', () => {
  const jwt = new JwtService({ secret })
  let g: RealtimeGateway
  beforeAll(() => { process.env.JWT_SECRET = secret })
  beforeEach(() => { g = new RealtimeGateway(jwt) })

  it('connect com token válido entra na sala user:<sub>', () => {
    const token = jwt.sign({ sub: 'u1', role: 'WORKER' })
    const c = fakeSocket(token) as any
    g.handleConnection(c)
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

  it('connect sem/ com token inválido desconecta', () => {
    const c = fakeSocket('lixo') as any
    g.handleConnection(c)
    expect(c.disconnect).toHaveBeenCalled()
    const c2 = fakeSocket(undefined) as any
    g.handleConnection(c2)
    expect(c2.disconnect).toHaveBeenCalled()
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
