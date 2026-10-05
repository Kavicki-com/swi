import type { JwtUser } from '../auth/current-user.decorator'
import { LIVE_DEFAULT_ICE_SERVERS } from '../config/runtime-env'
import { LiveController } from './live.controller'
import type { LiveService } from './live.service'

// A lista de quem transmite é do administrador e da empresa do token. Os
// servidores de conexão servem aos dois lados: o celular e o painel.

const admin = { userId: 'a1', companyId: 'c1', role: 'ADMIN' } as JwtUser

describe('LiveController', () => {
  const original = process.env.LIVE_ICE_SERVERS
  afterEach(() => {
    if (original === undefined) delete process.env.LIVE_ICE_SERVERS
    else process.env.LIVE_ICE_SERVERS = original
  })

  it('lista quem transmite na empresa do token', () => {
    const live = { list: jest.fn().mockReturnValue([{ workerId: 'w1', name: 'Ana', startedAt: '2026-10-05T14:32:00.000Z' }]) }
    const c = new LiveController(live as unknown as LiveService)
    expect(c.list(admin)).toEqual([{ workerId: 'w1', name: 'Ana', startedAt: '2026-10-05T14:32:00.000Z' }])
    expect(live.list).toHaveBeenCalledWith('c1')
  })

  it('a lista é só do administrador; os servidores de conexão, de qualquer logado', () => {
    expect(Reflect.getMetadata('roles', LiveController.prototype.list)).toEqual(['ADMIN'])
    expect(Reflect.getMetadata('roles', LiveController.prototype.iceServers)).toBeUndefined()
  })

  it('devolve os servidores de conexão da variável, ou o STUN padrão', () => {
    const c = new LiveController({} as LiveService)
    delete process.env.LIVE_ICE_SERVERS
    expect(c.iceServers()).toEqual({ iceServers: LIVE_DEFAULT_ICE_SERVERS })
    process.env.LIVE_ICE_SERVERS = '[{"urls":"turn:turn.exemplo.com:3478","username":"u","credential":"p"}]'
    expect(c.iceServers()).toEqual({ iceServers: [{ urls: 'turn:turn.exemplo.com:3478', username: 'u', credential: 'p' }] })
  })
})
