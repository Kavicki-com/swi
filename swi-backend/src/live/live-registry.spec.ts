import { LIVE_MAX_VIEWERS, LiveRegistry } from './live-registry'

// Quem está ao vivo fica só em memória: sem tabela e sem migration. O registro
// é puro (sem socket, sem banco) para que as regras de quem vê quem sejam
// provadas aqui, e o serviço só traduza o resultado em avisos.

const at = new Date('2026-10-05T14:32:00.000Z')
let seq = 0
const ids = () => `sessao-${++seq}`

const fresh = () => {
  seq = 0
  return new LiveRegistry(ids)
}

const startWorker = (r: LiveRegistry, over: Partial<{ workerId: string; companyId: string; name: string; socketId: string }> = {}) =>
  r.start({ workerId: 'w1', companyId: 'c1', name: 'Ana', socketId: 'cel-1', ...over }, at)

describe('LiveRegistry: transmitir', () => {
  it('liga a transmissão e aparece na lista da empresa', () => {
    const r = fresh()
    expect(startWorker(r)).toEqual({ fresh: true, replaced: null })
    expect(r.list('c1')).toEqual([{ workerId: 'w1', name: 'Ana', startedAt: '2026-10-05T14:32:00.000Z' }])
    expect(r.list('c2')).toEqual([])
  })

  it('ligar de novo pelo mesmo socket não reinicia nem derruba quem assiste', () => {
    const r = fresh()
    startWorker(r)
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-1' })
    expect(startWorker(r)).toEqual({ fresh: false, replaced: null })
    expect(r.route('sessao-1', 'painel-1')).toEqual({ to: 'cel-1', from: 'viewer' })
  })

  it('ligar por outro socket do mesmo funcionário substitui a transmissão antiga', () => {
    const r = fresh()
    startWorker(r)
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-1' })
    const result = startWorker(r, { socketId: 'cel-2' })
    expect(result).toEqual({
      fresh: true,
      replaced: { socketId: 'cel-1', sessions: [{ sessionId: 'sessao-1', viewerSocketId: 'painel-1' }] },
    })
    expect(r.route('sessao-1', 'painel-1')).toBeNull()
    expect(r.stop('cel-1')).toBeNull()
  })

  it('parar só vale para o socket que transmite e devolve quem assistia', () => {
    const r = fresh()
    startWorker(r)
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-1' })
    expect(r.stop('painel-1')).toBeNull()
    expect(r.stop('cel-1')).toEqual({
      workerId: 'w1',
      companyId: 'c1',
      socketId: 'cel-1',
      viewers: [{ sessionId: 'sessao-1', viewerSocketId: 'painel-1' }],
    })
    expect(r.list('c1')).toEqual([])
    expect(r.stop('cel-1')).toBeNull()
  })

  it('o próprio funcionário para de outro socket dele, como o app reconectado antes de a queda chegar', () => {
    const r = fresh()
    startWorker(r)
    expect(r.stop('cel-2', 'w2')).toBeNull()
    expect(r.list('c1')).toHaveLength(1)
    expect(r.stop('cel-2', 'w1')).toEqual({ workerId: 'w1', companyId: 'c1', socketId: 'cel-1', viewers: [] })
    expect(r.list('c1')).toEqual([])
  })
})

describe('LiveRegistry: assistir', () => {
  it('administrador da mesma empresa assiste e recebe uma sessão', () => {
    const r = fresh()
    startWorker(r)
    expect(r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-1' })).toEqual({
      ok: true,
      sessionId: 'sessao-1',
      broadcasterSocketId: 'cel-1',
      replacedSessionId: null,
    })
  })

  it('outra empresa ouve que não há transmissão, sem saber que ela existe', () => {
    const r = fresh()
    startWorker(r)
    expect(r.watch({ workerId: 'w1', companyId: 'c2', viewerSocketId: 'painel-9' })).toEqual({ ok: false, error: 'not-live' })
    expect(r.watch({ workerId: 'ninguem', companyId: 'c1', viewerSocketId: 'painel-1' })).toEqual({ ok: false, error: 'not-live' })
  })

  it(`no máximo ${LIVE_MAX_VIEWERS} espectadores por transmissão`, () => {
    const r = fresh()
    startWorker(r)
    for (let i = 1; i <= LIVE_MAX_VIEWERS; i++) {
      expect(r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: `painel-${i}` })).toMatchObject({ ok: true })
    }
    expect(r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-extra' })).toEqual({ ok: false, error: 'full' })
    r.unwatch('sessao-1', 'painel-1')
    expect(r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-extra' })).toMatchObject({ ok: true })
  })

  it('o mesmo painel assistindo de novo troca a sessão, sem ocupar outra vaga', () => {
    const r = fresh()
    startWorker(r)
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-1' })
    expect(r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-1' })).toEqual({
      ok: true,
      sessionId: 'sessao-2',
      broadcasterSocketId: 'cel-1',
      replacedSessionId: 'sessao-1',
    })
    expect(r.route('sessao-1', 'painel-1')).toBeNull()
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-2' })
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-3' })
    expect(r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-4' })).toEqual({ ok: false, error: 'full' })
  })

  it('sair de assistir só vale para o painel da sessão', () => {
    const r = fresh()
    startWorker(r)
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-1' })
    expect(r.unwatch('sessao-1', 'painel-2')).toBeNull()
    expect(r.unwatch('sessao-1', 'painel-1')).toEqual({ workerId: 'w1', broadcasterSocketId: 'cel-1' })
    expect(r.unwatch('sessao-1', 'painel-1')).toBeNull()
  })
})

describe('LiveRegistry: repasse', () => {
  it('só os dois lados da sessão trocam mensagens, cada um para o outro', () => {
    const r = fresh()
    startWorker(r)
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-1' })
    expect(r.route('sessao-1', 'cel-1')).toEqual({ to: 'painel-1', from: 'broadcaster' })
    expect(r.route('sessao-1', 'painel-1')).toEqual({ to: 'cel-1', from: 'viewer' })
    expect(r.route('sessao-1', 'intruso')).toBeNull()
    expect(r.route('sessao-inexistente', 'cel-1')).toBeNull()
  })
})

describe('LiveRegistry: queda de socket', () => {
  it('cair o celular encerra a transmissão e devolve quem assistia', () => {
    const r = fresh()
    startWorker(r)
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-1' })
    expect(r.leave('cel-1')).toEqual({
      ended: { workerId: 'w1', companyId: 'c1', socketId: 'cel-1', viewers: [{ sessionId: 'sessao-1', viewerSocketId: 'painel-1' }] },
      left: [],
    })
    expect(r.list('c1')).toEqual([])
  })

  it('cair o painel encerra só as sessões dele e libera a vaga', () => {
    const r = fresh()
    startWorker(r)
    startWorker(r, { workerId: 'w2', name: 'Bruno', socketId: 'cel-2' })
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-1' })
    r.watch({ workerId: 'w2', companyId: 'c1', viewerSocketId: 'painel-1' })
    r.watch({ workerId: 'w1', companyId: 'c1', viewerSocketId: 'painel-2' })
    expect(r.leave('painel-1')).toEqual({
      ended: null,
      left: [
        { sessionId: 'sessao-1', broadcasterSocketId: 'cel-1' },
        { sessionId: 'sessao-2', broadcasterSocketId: 'cel-2' },
      ],
    })
    expect(r.route('sessao-3', 'painel-2')).toEqual({ to: 'cel-1', from: 'viewer' })
    expect(r.list('c1').map((b) => b.workerId)).toEqual(['w1', 'w2'])
  })

  it('socket desconhecido não muda nada', () => {
    const r = fresh()
    startWorker(r)
    expect(r.leave('qualquer')).toEqual({ ended: null, left: [] })
    expect(r.list('c1')).toHaveLength(1)
  })
})
