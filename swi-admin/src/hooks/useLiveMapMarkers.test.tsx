// vitest globals (describe/it/expect/vi) via globals: true.
import { renderHook } from '@testing-library/react'
import type { DashboardMapMarker } from '@/services/api/dashboard'
import type { AdminWorkersTelemetry } from '@/services/api/telemetry'
import { adminWorker, condition, reporting } from '@/test-utils/telemetryFixtures'
import { useLiveMapMarkers } from './useLiveMapMarkers'

const positions = vi.hoisted(() => ({ value: null as DashboardMapMarker[] | null }))
const telemetry = vi.hoisted(() => ({
  value: { workers: null as AdminWorkersTelemetry | null, failed: false },
}))

vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => positions.value }))
vi.mock('@/hooks/useAdminTelemetry', () => ({
  useAdminTelemetry: () => ({
    workers: telemetry.value.workers,
    summary: null,
    loading: false,
    failed: telemetry.value.failed,
    refresh: () => {},
  }),
}))

const pin = (id: string, lat = -23.55): DashboardMapMarker => ({
  id,
  name: id,
  lat,
  lng: -46.63,
  status: 'offline',
  avatarUri: '',
})

describe('useLiveMapMarkers', () => {
  beforeEach(() => {
    positions.value = null
    telemetry.value = { workers: null, failed: false }
  })

  it('carregando as posições devolve null', () => {
    const { result } = renderHook(() => useLiveMapMarkers())
    expect(result.current.markers).toBeNull()
  })

  it('pinta cada pino com o estado real e expõe a entrada de cada funcionário', () => {
    positions.value = [pin('w1'), pin('w2', -23.6)]
    const urgent = adminWorker('w2', 'Bia', {
      telemetry: { ...reporting({}, 'REAL', 'w2'), conditions: [condition('URGENT')] },
    })
    telemetry.value = {
      workers: {
        observedAt: '2026-10-01T15:00:00.000Z',
        workers: [adminWorker('w1', 'Ana'), urgent],
      },
      failed: false,
    }
    const { result } = renderHook(() => useLiveMapMarkers())
    expect(result.current.markers?.map((m) => m.status)).toEqual(['good', 'low'])
    expect(result.current.markers?.[1]?.lat).toBe(-23.6)
    expect(result.current.entryFor('w2')?.worker.name).toBe('Bia')
    expect(result.current.entryFor('w9')).toBeUndefined()
  })

  // Sem a telemetria ninguém sabe o estado: pinos neutros, nunca verdes.
  it('falha da telemetria deixa todos neutros e avisa', () => {
    positions.value = [pin('w1')]
    telemetry.value = { workers: null, failed: true }
    const { result } = renderHook(() => useLiveMapMarkers())
    expect(result.current.markers?.[0]?.status).toBe('offline')
    expect(result.current.telemetryFailed).toBe(true)
  })
})
