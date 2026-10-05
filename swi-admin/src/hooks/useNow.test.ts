// vitest globals (describe/it/expect/vi) via globals: true.
import { act, renderHook } from '@testing-library/react'
import { useNow } from './useNow'

afterEach(() => {
  vi.useRealTimers()
})

it('devolve a hora de agora e anda a cada intervalo', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 5, 14, 0, 0))
  const { result } = renderHook(() => useNow(30_000))
  const start = result.current
  expect(start).toBe(new Date(2026, 9, 5, 14, 0, 0).getTime())

  act(() => {
    vi.advanceTimersByTime(29_999)
  })
  expect(result.current).toBe(start)

  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(result.current).toBe(start + 30_000)
})

it('para de andar ao sair da tela', () => {
  vi.useFakeTimers()
  const { unmount } = renderHook(() => useNow(30_000))
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
