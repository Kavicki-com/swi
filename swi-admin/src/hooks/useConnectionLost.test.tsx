// vitest globals (describe/it/expect/vi) via globals: true.
import { act, renderHook } from '@testing-library/react'
import { CONNECTION_GRACE_MS, connectionStatus } from '@/services/realtime/connectionStatus'
import { useConnectionLost } from './useConnectionLost'

// Socket de mentira registrado no armazém real do painel.
function fakeSocket() {
  const handlers = new Map<string, (reason?: unknown) => void>()
  return {
    on: (event: string, h: (reason?: unknown) => void) => void handlers.set(event, h),
    off: (event: string) => void handlers.delete(event),
    emit: (event: string, reason?: unknown) => handlers.get(event)?.(reason),
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('com a conexão de pé, não há queda', () => {
  const { result } = renderHook(() => useConnectionLost())
  expect(result.current).toBe(false)
})

it('o navegador avisando que ficou offline vale na hora, sem esperar a carência', () => {
  const { result } = renderHook(() => useConnectionLost())
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
  expect(result.current).toBe(true)

  act(() => {
    window.dispatchEvent(new Event('online'))
  })
  expect(result.current).toBe(false)
})

it('a tela aberta com o navegador já offline começa avisando', () => {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
  const { result } = renderHook(() => useConnectionLost())
  expect(result.current).toBe(true)
})

it('socket caído além da carência é queda, e a volta dele desfaz o aviso', () => {
  vi.useFakeTimers()
  const socket = fakeSocket()
  const unwatch = connectionStatus.watch(socket)
  const { result } = renderHook(() => useConnectionLost())

  act(() => {
    socket.emit('connect')
    socket.emit('disconnect', 'transport close')
  })
  expect(result.current).toBe(false)

  act(() => {
    vi.advanceTimersByTime(CONNECTION_GRACE_MS)
  })
  expect(result.current).toBe(true)

  act(() => {
    socket.emit('connect')
  })
  expect(result.current).toBe(false)
  unwatch()
})
