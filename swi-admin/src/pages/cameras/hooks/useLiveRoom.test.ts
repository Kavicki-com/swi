// Aba "Ao vivo": lista de quem transmite (API + avisos do socket, relida na
// volta da conexão) e o funcionário escolhido para assistir. O viewer é o de
// verdade; o RTCPeerConnection do navegador é um dublê global.
import { StrictMode, createElement, type ReactNode } from 'react'
import { vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { LiveBroadcast } from '@/services/api/live'
import type { LiveSocketEvents } from '@/services/live/liveSocket'

const api = vi.hoisted(() => ({ list: vi.fn(), iceServers: vi.fn() }))
vi.mock('@/services/api/live', () => ({ liveApi: api }))

const socket = vi.hoisted(() => {
  const state = { events: null as LiveSocketEvents | null }
  const live = {
    watch: vi.fn(),
    unwatch: vi.fn(),
    answer: vi.fn(),
    candidate: vi.fn(),
    close: vi.fn(),
  }
  return { state, live, open: vi.fn() }
})
vi.mock('@/services/live/liveSocket', () => ({
  openLiveSocket: (events: LiveSocketEvents) => {
    socket.state.events = events
    socket.open()
    return socket.live
  },
}))

const reconnect = vi.hoisted(() => ({ listeners: new Set<() => void>() }))
vi.mock('@/services/realtime/connectionStatus', () => ({
  connectionStatus: {
    onReconnect: (listener: () => void) => {
      reconnect.listeners.add(listener)
      return () => reconnect.listeners.delete(listener)
    },
  },
}))

import { useLiveRoom } from './useLiveRoom'

/** RTCPeerConnection mínimo: guarda o que recebe e responde a oferta. */
class FakePeer {
  static all: FakePeer[] = []
  remoteDescription: RTCSessionDescriptionInit | null = null
  added: RTCIceCandidateInit[] = []
  closed = false
  ontrack = null
  onicecandidate = null
  onconnectionstatechange = null
  constructor(public config: RTCConfiguration) {
    FakePeer.all.push(this)
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'v=0 resposta' }
  }
  async setLocalDescription() {}
  async addIceCandidate(c: RTCIceCandidateInit) {
    this.added.push(c)
  }
  close() {
    this.closed = true
  }
}

const ana: LiveBroadcast = { workerId: 'w1', name: 'Ana', startedAt: '2026-10-05T14:32:00.000Z' }
const bruno: LiveBroadcast = {
  workerId: 'w2',
  name: 'Bruno',
  startedAt: '2026-10-05T14:40:00.000Z',
}

const events = () => socket.state.events!
/** A volta de QUALQUER socket do painel (armazém de conexão global). */
const anySocketBack = () => act(() => reconnect.listeners.forEach((l) => l()))

beforeEach(() => {
  api.list.mockReset().mockResolvedValue([ana])
  api.iceServers.mockReset().mockResolvedValue([{ urls: 'stun:stun.exemplo.com:3478' }])
  for (const fn of Object.values(socket.live)) fn.mockReset()
  socket.live.watch.mockResolvedValue({ ok: true, sessionId: 's1' })
  socket.open.mockReset()
  reconnect.listeners.clear()
  FakePeer.all = []
  vi.stubGlobal('RTCPeerConnection', FakePeer)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useLiveRoom', () => {
  it('carrega a lista pela API ao abrir', async () => {
    const { result } = renderHook(() => useLiveRoom(null))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.broadcasts).toEqual([ana])
    expect(result.current.error).toBe(false)
  })

  it('quem liga e quem para muda a lista na hora', async () => {
    const { result } = renderHook(() => useLiveRoom(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => events().onStarted(bruno))
    expect(result.current.broadcasts).toEqual([ana, bruno])
    act(() => events().onStopped('w1'))
    expect(result.current.broadcasts).toEqual([bruno])
  })

  it('na volta da conexão relê, sem desfazer o que chegou enquanto a resposta vinha', async () => {
    const { result } = renderHook(() => useLiveRoom(null))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let answer!: (list: LiveBroadcast[]) => void
    api.list.mockImplementationOnce(() => new Promise((r) => (answer = r)))
    anySocketBack()
    // Durante a releitura: Bruno liga e Ana para.
    act(() => events().onStarted(bruno))
    act(() => events().onStopped('w1'))
    // A resposta foi montada antes desses avisos e ainda tem Ana sem Bruno.
    await act(async () => answer([ana]))
    expect(result.current.broadcasts).toEqual([bruno])
  })

  it('falha ao abrir mostra o erro, e tentar de novo relê', async () => {
    api.list.mockRejectedValueOnce(new Error('fora'))
    const { result } = renderHook(() => useLiveRoom(null))
    await waitFor(() => expect(result.current.error).toBe(true))
    await act(async () => result.current.retryList())
    await waitFor(() => expect(result.current.error).toBe(false))
    expect(result.current.broadcasts).toEqual([ana])
  })

  it('falha na releitura mantém a lista que está na tela', async () => {
    const { result } = renderHook(() => useLiveRoom(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    api.list.mockRejectedValueOnce(new Error('fora'))
    anySocketBack()
    await act(async () => {})
    expect(result.current.broadcasts).toEqual([ana])
    expect(result.current.error).toBe(false)
  })

  it('escolher um funcionário pede para assistir; desfazer a escolha avisa o servidor', async () => {
    const { result, rerender } = renderHook(({ id }) => useLiveRoom(id), {
      initialProps: { id: null as string | null },
    })
    rerender({ id: 'w1' })
    await waitFor(() => expect(socket.live.watch).toHaveBeenCalledWith('w1'))
    expect(result.current.view).toEqual({ status: 'connecting', workerId: 'w1', stream: null })
    rerender({ id: null })
    expect(socket.live.unwatch).toHaveBeenCalledWith('s1')
    expect(result.current.view.status).toBe('idle')
  })

  it('oferta, candidato e fim do socket chegam à conexão com o celular', async () => {
    const { result } = renderHook(() => useLiveRoom('w1'))
    await waitFor(() => expect(socket.live.watch).toHaveBeenCalledWith('w1'))
    await act(async () => {})
    await act(async () => events().onOffer('s1', 'v=0 oferta'))
    await waitFor(() => expect(socket.live.answer).toHaveBeenCalledWith('s1', 'v=0 resposta'))
    const peer = FakePeer.all[0]!
    expect(peer.config).toEqual({ iceServers: [{ urls: 'stun:stun.exemplo.com:3478' }] })
    await act(async () => events().onCandidate('s1', { candidate: 'c1' }))
    expect(peer.added).toEqual([{ candidate: 'c1' }])
    act(() => events().onEnded('s1', 'w1'))
    expect(result.current.view.status).toBe('ended')
    expect(peer.closed).toBe(true)
  })

  it('tentar de novo repete o pedido', async () => {
    socket.live.watch.mockResolvedValueOnce({ ok: false, error: 'full' })
    const { result } = renderHook(() => useLiveRoom('w1'))
    await waitFor(() => expect(result.current.view.status).toBe('full'))
    await act(async () => result.current.retryWatch())
    expect(socket.live.watch).toHaveBeenCalledTimes(2)
  })

  it('a volta de outro socket do painel relê a lista, mas não mexe no vídeo', async () => {
    renderHook(() => useLiveRoom('w1'))
    await waitFor(() => expect(socket.live.watch).toHaveBeenCalledTimes(1))
    api.list.mockClear()
    anySocketBack()
    await act(async () => {})
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(socket.live.watch).toHaveBeenCalledTimes(1)
  })

  it('a volta do socket da transmissão pede de novo o funcionário escolhido', async () => {
    renderHook(() => useLiveRoom('w1'))
    await waitFor(() => expect(socket.live.watch).toHaveBeenCalledTimes(1))
    await act(async () => {})
    act(() => events().onReconnect())
    await waitFor(() => expect(socket.live.watch).toHaveBeenCalledTimes(2))
    expect(socket.live.unwatch).not.toHaveBeenCalled()
  })

  it('falha ao buscar os servidores de conexão não fica guardada para a próxima conexão', async () => {
    socket.live.watch
      .mockResolvedValueOnce({ ok: true, sessionId: 's1' })
      .mockResolvedValueOnce({ ok: true, sessionId: 's2' })
    api.iceServers.mockRejectedValueOnce(new Error('502'))
    const { result } = renderHook(() => useLiveRoom('w1'))
    await waitFor(() => expect(socket.live.watch).toHaveBeenCalledTimes(1))
    await act(async () => {})
    await act(async () => events().onOffer('s1', 'v=0 oferta'))
    await waitFor(() => expect(FakePeer.all).toHaveLength(1))
    expect(FakePeer.all[0]!.config).toEqual({ iceServers: [] })

    await act(async () => result.current.retryWatch())
    await act(async () => events().onOffer('s2', 'v=0 oferta'))
    await waitFor(() => expect(FakePeer.all).toHaveLength(2))
    expect(FakePeer.all[1]!.config).toEqual({
      iceServers: [{ urls: 'stun:stun.exemplo.com:3478' }],
    })
  })

  it('em StrictMode (efeitos rodando duas vezes) assiste com um socket só aberto', async () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(StrictMode, null, children)
    const { result, unmount } = renderHook(() => useLiveRoom('w1'), { wrapper })
    await waitFor(() => expect(result.current.view.status).toBe('connecting'))
    await act(async () => {})
    expect(socket.open.mock.calls.length - socket.live.close.mock.calls.length).toBe(1)
    unmount()
    expect(socket.open.mock.calls.length).toBe(socket.live.close.mock.calls.length)
    expect(reconnect.listeners.size).toBe(0)
  })

  it('ao fechar a aba, larga a sessão e fecha o socket', async () => {
    const { unmount } = renderHook(() => useLiveRoom('w1'))
    await waitFor(() => expect(socket.live.watch).toHaveBeenCalled())
    await act(async () => {})
    unmount()
    expect(socket.live.unwatch).toHaveBeenCalledWith('s1')
    expect(socket.live.close).toHaveBeenCalled()
    expect(socket.live.unwatch.mock.invocationCallOrder[0]!).toBeLessThan(
      socket.live.close.mock.invocationCallOrder[0]!,
    )
    expect(reconnect.listeners.size).toBe(0)
  })
})
