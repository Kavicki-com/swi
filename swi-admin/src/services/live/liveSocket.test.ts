import { vi } from 'vitest'

// vi.mock é hoistado; os dublês precisam existir antes dele (padrão do repo).
const sock = vi.hoisted(() => {
  const on = vi.fn()
  const off = vi.fn()
  const close = vi.fn()
  const emit = vi.fn()
  const emitWithAck = vi.fn()
  const timeout = vi.fn(() => ({ emitWithAck }))
  return {
    on,
    off,
    close,
    emit,
    emitWithAck,
    timeout,
    io: vi.fn(() => ({ on, off, close, emit, timeout })),
  }
})
vi.mock('socket.io-client', () => ({ io: sock.io }))

import { openLiveSocket } from './liveSocket'
import { CONNECTION_GRACE_MS, connectionStatus } from '../realtime/connectionStatus'

const handlerOf = (event: string) =>
  (sock.on.mock.calls as unknown as [string, (arg?: unknown) => void][]).find(
    ([name]) => name === event,
  )![1]

const events = () => ({
  onStarted: vi.fn(),
  onStopped: vi.fn(),
  onOffer: vi.fn(),
  onCandidate: vi.fn(),
  onEnded: vi.fn(),
  onReconnect: vi.fn(),
})

afterEach(() => {
  vi.useRealTimers()
  for (const fn of [
    sock.on,
    sock.off,
    sock.close,
    sock.emit,
    sock.emitWithAck,
    sock.timeout,
    sock.io,
  ])
    fn.mockClear()
})

it('repassa os avisos do servidor e ignora os que vêm fora do contrato', () => {
  const e = events()
  const live = openLiveSocket(e)
  handlerOf('live.started')({ workerId: 'w1', name: 'Ana', startedAt: '2026-10-05T14:32:00.000Z' })
  handlerOf('live.started')({ workerId: 7 })
  handlerOf('live.stopped')({ workerId: 'w1' })
  handlerOf('live.offer')({ sessionId: 's1', sdp: 'v=0' })
  handlerOf('live.offer')({ sessionId: 's1' })
  handlerOf('live.candidate')({ sessionId: 's1', candidate: { candidate: '' } })
  handlerOf('live.ended')({ sessionId: 's1', workerId: 'w1' })
  expect(e.onStarted).toHaveBeenCalledTimes(1)
  expect(e.onStarted).toHaveBeenCalledWith({
    workerId: 'w1',
    name: 'Ana',
    startedAt: '2026-10-05T14:32:00.000Z',
  })
  expect(e.onStopped).toHaveBeenCalledWith('w1')
  expect(e.onOffer).toHaveBeenCalledTimes(1)
  expect(e.onOffer).toHaveBeenCalledWith('s1', 'v=0')
  expect(e.onCandidate).toHaveBeenCalledWith('s1', { candidate: '' })
  expect(e.onEnded).toHaveBeenCalledWith('s1', 'w1')
  live.close()
})

it('avisa a volta deste socket depois de uma queda, e não a primeira conexão', () => {
  const e = events()
  const live = openLiveSocket(e)
  const fire = (event: string, arg?: unknown) => {
    for (const [name, listener] of sock.on.mock.calls as unknown as [
      string,
      (a?: unknown) => void,
    ][]) {
      if (name === event) listener(arg)
    }
  }
  fire('connect')
  expect(e.onReconnect).not.toHaveBeenCalled()
  fire('disconnect', 'transport close')
  fire('connect')
  expect(e.onReconnect).toHaveBeenCalledTimes(1)
  live.close()
})

it('assistir pede com confirmação e devolve a sessão; falta de resposta vira erro', async () => {
  const live = openLiveSocket(events())
  sock.emitWithAck.mockResolvedValueOnce({ ok: true, sessionId: 's1' })
  await expect(live.watch('w1')).resolves.toEqual({ ok: true, sessionId: 's1' })
  expect(sock.emitWithAck).toHaveBeenCalledWith('live.watch', { workerId: 'w1' })

  sock.emitWithAck.mockResolvedValueOnce({ ok: false, error: 'full' })
  await expect(live.watch('w1')).resolves.toEqual({ ok: false, error: 'full' })

  sock.emitWithAck.mockRejectedValueOnce(new Error('operation has timed out'))
  await expect(live.watch('w1')).resolves.toEqual({ ok: false, error: 'timeout' })

  sock.emitWithAck.mockResolvedValueOnce({ ok: true })
  await expect(live.watch('w1')).resolves.toEqual({ ok: false, error: 'invalid' })
  live.close()
})

it('sair, resposta e candidato saem para o servidor', () => {
  const live = openLiveSocket(events())
  live.unwatch('s1')
  live.answer('s1', 'v=0 resposta')
  live.candidate('s1', { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 })
  expect(sock.emit.mock.calls).toEqual([
    ['live.unwatch', { sessionId: 's1' }],
    ['live.answer', { sessionId: 's1', sdp: 'v=0 resposta' }],
    [
      'live.candidate',
      { sessionId: 's1', candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 } },
    ],
  ])
  live.close()
})

it('a conexão entra no estado de conexão do painel e sai dele antes de fechar', () => {
  vi.useFakeTimers()
  const live = openLiveSocket(events())
  handlerOf('disconnect')('transport error')
  vi.advanceTimersByTime(CONNECTION_GRACE_MS)
  expect(connectionStatus.isLost()).toBe(true)

  live.close()
  expect(connectionStatus.isLost()).toBe(false)
  expect(sock.off).toHaveBeenCalledWith('disconnect', handlerOf('disconnect'))
  expect(sock.close).toHaveBeenCalled()
  expect(sock.off.mock.invocationCallOrder[0]!).toBeLessThan(
    sock.close.mock.invocationCallOrder[0]!,
  )
})
