import { RealtimeGateway } from '../realtime/realtime.gateway'
import { LiveGateway } from './live.gateway'
import { LiveRateLimit } from './live-rate-limit'
import type { LiveOutcome, LiveService } from './live.service'
import { socketToken } from './socket-token'

// O gateway só traduz: chama o serviço, entrega os avisos que ele devolveu e
// responde a confirmação. As regras moram no serviço e no registro. O que é
// dele: a ordem dos eventos de cada socket e o limite por socket.

const outcome = (over: Partial<LiveOutcome> = {}): LiveOutcome => ({ reply: { ok: true }, deliveries: [], ...over })

const serviceDouble = () =>
  ({
    start: jest.fn().mockResolvedValue(outcome()),
    stop: jest.fn().mockResolvedValue(outcome()),
    watch: jest.fn().mockResolvedValue(outcome({ reply: { ok: true, sessionId: 's1' } })),
    unwatch: jest.fn().mockReturnValue(outcome()),
    relay: jest.fn().mockReturnValue(outcome()),
    leave: jest.fn().mockResolvedValue([]),
  }) as unknown as jest.Mocked<LiveService>

const client = (id = 'sock-1', auth: Record<string, unknown> = { token: 'tok' }, headers: Record<string, string> = {}) =>
  ({ id, handshake: { auth, headers }, data: { userId: 'w1' } }) as never

/** Promessa que o teste resolve na hora que quiser. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const flush = () => new Promise((r) => setImmediate(r))

describe('LiveGateway', () => {
  let live: jest.Mocked<LiveService>
  let realtime: { emitToUsers: jest.Mock }
  let emit: jest.Mock
  let to: jest.Mock
  let g: LiveGateway

  const build = (limits = new LiveRateLimit()) => {
    g = new LiveGateway(live, realtime as unknown as RealtimeGateway, limits)
    g.server = { to } as never
  }

  beforeEach(() => {
    live = serviceDouble()
    realtime = { emitToUsers: jest.fn() }
    emit = jest.fn()
    to = jest.fn(() => ({ emit }))
    build()
  })

  it('tem as mesmas opções do socket que já existe, então é o mesmo servidor', () => {
    const own = Reflect.getMetadata('websockets:gateway_options', LiveGateway)
    const existing = Reflect.getMetadata('websockets:gateway_options', RealtimeGateway)
    expect(own).toEqual(existing)
    expect(Reflect.getMetadata('websockets:gateway_namespace', LiveGateway) ?? undefined).toBeUndefined()
  })

  it('ligar passa o socket e o token do handshake e devolve a resposta do serviço', async () => {
    await expect(g.start(client())).resolves.toEqual({ ok: true })
    expect(live.start).toHaveBeenCalledWith('sock-1', 'tok')
  })

  it('parar passa também o usuário do socket, para o funcionário parar de outro socket dele', async () => {
    await g.stop(client())
    expect(live.stop).toHaveBeenCalledWith('sock-1', 'w1')
  })

  it('entrega cada aviso: ao socket certo ou às salas dos usuários', async () => {
    live.stop.mockResolvedValueOnce(
      outcome({
        deliveries: [
          { socketId: 'painel-1', event: 'live.ended', payload: { sessionId: 's1', workerId: 'w1' } },
          { userIds: ['a1', 'a2'], event: 'live.stopped', payload: { workerId: 'w1' } },
        ],
      }),
    )
    await g.stop(client())
    expect(to).toHaveBeenCalledWith('painel-1')
    expect(emit).toHaveBeenCalledWith('live.ended', { sessionId: 's1', workerId: 'w1' })
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['a1', 'a2'], 'live.stopped', { workerId: 'w1' })
  })

  it('assistir, sair, oferta, resposta e candidato chegam ao serviço com o corpo recebido', async () => {
    const c = client()
    await expect(g.watch(c, { workerId: 'w1' })).resolves.toEqual({ ok: true, sessionId: 's1' })
    expect(live.watch).toHaveBeenCalledWith('sock-1', 'tok', { workerId: 'w1' })
    await g.unwatch(c, { sessionId: 's1' })
    expect(live.unwatch).toHaveBeenCalledWith('sock-1', { sessionId: 's1' })
    await g.offer(c, { sessionId: 's1', sdp: 'o' })
    await g.answer(c, { sessionId: 's1', sdp: 'a' })
    await g.candidate(c, { sessionId: 's1', candidate: { candidate: '' } })
    expect(live.relay.mock.calls).toEqual([
      ['offer', 'sock-1', { sessionId: 's1', sdp: 'o' }],
      ['answer', 'sock-1', { sessionId: 's1', sdp: 'a' }],
      ['candidate', 'sock-1', { sessionId: 's1', candidate: { candidate: '' } }],
    ])
  })

  it('falha inesperada vira resposta de erro, sem derrubar o socket nem travar a fila', async () => {
    live.start.mockRejectedValueOnce(new Error('quebrou'))
    await expect(g.start(client())).resolves.toEqual({ ok: false, error: 'internal' })
    await expect(g.stop(client())).resolves.toEqual({ ok: true })
  })

  describe('ordem dos eventos de um socket', () => {
    // O socket.io entrega cada evento sem esperar o anterior. Sem a fila, um
    // parar enviado logo depois de ligar rodaria durante a consulta ao banco
    // do ligar, não acharia nada, e o ligar registraria em seguida.
    it('parar enviado durante o ligar só roda depois dele', async () => {
      const slow = deferred<LiveOutcome>()
      live.start.mockReturnValueOnce(slow.promise)
      const started = g.start(client())
      const stopped = g.stop(client())
      await flush()
      expect(live.stop).not.toHaveBeenCalled()
      slow.resolve(outcome())
      await Promise.all([started, stopped])
      expect(live.stop).toHaveBeenCalledTimes(1)
      expect(live.start.mock.invocationCallOrder[0]).toBeLessThan(live.stop.mock.invocationCallOrder[0])
    })

    it('sockets diferentes não esperam um pelo outro', async () => {
      const slow = deferred<LiveOutcome>()
      live.start.mockReturnValueOnce(slow.promise)
      const started = g.start(client('sock-1'))
      await g.stop(client('sock-2'))
      expect(live.stop).toHaveBeenCalledWith('sock-2', 'w1')
      slow.resolve(outcome())
      await started
    })

    it('a queda espera o que o socket ainda tinha em andamento', async () => {
      const slow = deferred<LiveOutcome>()
      live.watch.mockReturnValueOnce(slow.promise)
      const watching = g.watch(client(), { workerId: 'w1' })
      const gone = g.handleDisconnect(client())
      await flush()
      expect(live.leave).not.toHaveBeenCalled()
      slow.resolve(outcome({ reply: { ok: true, sessionId: 's1' } }))
      await Promise.all([watching, gone])
      expect(live.leave).toHaveBeenCalledWith('sock-1')
      expect(live.watch.mock.invocationCallOrder[0]).toBeLessThan(live.leave.mock.invocationCallOrder[0])
    })
  })

  describe('limite por socket', () => {
    it('acima do teto responde rate-limited sem chamar o serviço', async () => {
      build(new LiveRateLimit(() => 0, { control: { max: 1, windowMs: 1000 }, relay: { max: 1, windowMs: 1000 } }))
      await g.start(client())
      await expect(g.watch(client(), { workerId: 'w1' })).resolves.toEqual({ ok: false, error: 'rate-limited' })
      expect(live.watch).not.toHaveBeenCalled()
      await g.offer(client(), { sessionId: 's1', sdp: 'o' })
      await expect(g.candidate(client(), { sessionId: 's1', candidate: { candidate: '' } })).resolves.toEqual({
        ok: false,
        error: 'rate-limited',
      })
      expect(live.relay).toHaveBeenCalledTimes(1)
    })

    it('a queda esquece a conta do socket', async () => {
      const limits = new LiveRateLimit()
      build(limits)
      await g.start(client())
      await g.handleDisconnect(client())
      expect(limits.size()).toBe(0)
    })
  })

  it('queda do socket encerra o que ele tinha e entrega os avisos', async () => {
    live.leave.mockResolvedValueOnce([{ socketId: 'cel-1', event: 'live.viewer-left', payload: { sessionId: 's1' } }])
    await g.handleDisconnect(client())
    expect(live.leave).toHaveBeenCalledWith('sock-1')
    expect(to).toHaveBeenCalledWith('cel-1')
    expect(emit).toHaveBeenCalledWith('live.viewer-left', { sessionId: 's1' })
  })

  it('falha ao encerrar na queda não escapa do gateway', async () => {
    live.leave.mockRejectedValueOnce(new Error('quebrou'))
    await expect(g.handleDisconnect(client())).resolves.toBeUndefined()
  })
})

describe('socketToken', () => {
  it('lê o token do handshake, e na falta dele o cabeçalho Bearer', () => {
    expect(socketToken(client('s', { token: 'do-auth' }))).toBe('do-auth')
    expect(socketToken(client('s', {}, { authorization: 'Bearer do-header' }))).toBe('do-header')
    expect(socketToken(client('s', {}, { authorization: 'Basic x' }))).toBe('')
    expect(socketToken(client('s', { token: 7 }))).toBe('')
  })
})
