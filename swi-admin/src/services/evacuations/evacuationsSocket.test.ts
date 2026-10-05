import { vi } from 'vitest'

// vi.mock é hoistado; os dublês precisam existir antes dele (padrão do repo).
const { onMock, offMock, closeMock, ioMock } = vi.hoisted(() => {
  const onMock = vi.fn()
  const offMock = vi.fn()
  const closeMock = vi.fn()
  return {
    onMock,
    offMock,
    closeMock,
    ioMock: vi.fn(() => ({ on: onMock, off: offMock, close: closeMock })),
  }
})
vi.mock('socket.io-client', () => ({ io: ioMock }))

import { subscribeEvacuationEvents } from './evacuationsSocket'
import { CONNECTION_GRACE_MS, connectionStatus } from '../realtime/connectionStatus'

const handlerOf = (event: string) =>
  (onMock.mock.calls as unknown as [string, (arg?: unknown) => void][]).find(
    ([name]) => name === event,
  )![1]

const handlers = () => ({ onStarted: vi.fn(), onAck: vi.fn(), onEnded: vi.fn() })

afterEach(() => {
  vi.useRealTimers()
  onMock.mockClear()
  offMock.mockClear()
  closeMock.mockClear()
  ioMock.mockClear()
})

it('liga os três eventos do ciclo aos handlers e fecha a conexão na limpeza', () => {
  const h = handlers()
  const stop = subscribeEvacuationEvents(h)
  expect(handlerOf('evacuation')).toBe(h.onStarted)
  expect(handlerOf('evacuation-ack')).toBe(h.onAck)
  expect(handlerOf('evacuation-ended')).toBe(h.onEnded)
  stop()
  expect(closeMock).toHaveBeenCalled()
})

it('a conexão entra no estado de conexão do painel e sai dele ao fechar', () => {
  vi.useFakeTimers()
  const stop = subscribeEvacuationEvents(handlers())
  handlerOf('disconnect')('transport error')
  vi.advanceTimersByTime(CONNECTION_GRACE_MS)
  expect(connectionStatus.isLost()).toBe(true)

  stop()
  expect(connectionStatus.isLost()).toBe(false)
  expect(offMock).toHaveBeenCalledWith('disconnect', handlerOf('disconnect'))
})
