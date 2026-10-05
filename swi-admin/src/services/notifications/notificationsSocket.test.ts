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

import { subscribeNotifications } from './notificationsSocket'
import { CONNECTION_GRACE_MS, connectionStatus } from '../realtime/connectionStatus'

const handlerOf = (event: string) =>
  (onMock.mock.calls as unknown as [string, (arg?: unknown) => void][]).find(
    ([name]) => name === event,
  )![1]

afterEach(() => {
  vi.useRealTimers()
  onMock.mockClear()
  offMock.mockClear()
  closeMock.mockClear()
  ioMock.mockClear()
})

it('entrega cada notificação ao assinante e fecha a conexão na limpeza', () => {
  const cb = vi.fn()
  const stop = subscribeNotifications(cb)
  expect(handlerOf('notification')).toBe(cb)
  stop()
  expect(closeMock).toHaveBeenCalled()
})

it('a conexão entra no estado de conexão do painel e sai dele ao fechar', () => {
  vi.useFakeTimers()
  const stop = subscribeNotifications(vi.fn())
  handlerOf('connect_error')(new Error('xhr poll error'))
  vi.advanceTimersByTime(CONNECTION_GRACE_MS)
  expect(connectionStatus.isLost()).toBe(true)

  stop()
  expect(connectionStatus.isLost()).toBe(false)
  expect(offMock).toHaveBeenCalledWith('connect_error', handlerOf('connect_error'))
})
