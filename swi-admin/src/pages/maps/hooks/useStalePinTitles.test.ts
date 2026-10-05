// vitest globals (describe/it/expect/vi) via globals: true. Datas no fuso
// local: o texto sai no relógio do computador de quem olha.
import { act, renderHook } from '@testing-library/react'
import type { DashboardMapMarker } from '@/services/dashboard'
import { useStalePinTitles } from './useStalePinTitles'

const at = (hour: number, minute: number) => new Date(2026, 9, 5, hour, minute, 0)

const marker = (recordedAt: Date): DashboardMapMarker => ({
  id: 'w1',
  name: 'Ana Souza',
  lat: -23.55,
  lng: -46.63,
  status: 'good',
  avatarUri: '',
  recordedAt: recordedAt.toISOString(),
})

afterEach(() => {
  vi.useRealTimers()
})

it('posição atual não ganha texto; ao passar de 5 minutos ganha, sem recarregar a tela', () => {
  vi.useFakeTimers()
  vi.setSystemTime(at(14, 30))
  const markers = [marker(at(14, 29))]
  const { result } = renderHook(() => useStalePinTitles(markers))
  expect(result.current).toEqual([undefined])

  act(() => {
    vi.advanceTimersByTime(5 * 60_000)
  })
  expect(result.current).toEqual(['Ana Souza, última posição às 14:29'])
})

it('a lista só muda quando algum pino cruza o limiar, não a cada tique do relógio', () => {
  vi.useFakeTimers()
  vi.setSystemTime(at(14, 30))
  const markers = [marker(at(14, 0))]
  const { result } = renderHook(() => useStalePinTitles(markers))
  const first = result.current

  act(() => {
    vi.advanceTimersByTime(30_000)
  })
  expect(result.current).toBe(first)
})

it('sem pinos, sem textos', () => {
  const { result } = renderHook(() => useStalePinTitles([]))
  expect(result.current).toEqual([])
})
