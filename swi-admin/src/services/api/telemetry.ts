// Leitura da telemetria do piloto pelo painel (telemetry/v1). Os tipos espelham
// o contrato do backend (domain/telemetry.types.ts e read-model): cada métrica
// chega com valor, qualidade, instante e origem, e ausência é null, nunca zero.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'

export type TelemetryOrigin = 'REAL' | 'DEMO'

export type MetricQuality = 'CURRENT' | 'STALE' | 'UNAVAILABLE'

export type MeasurementSource =
  | 'APPLE_WATCH'
  | 'EXTERNAL_CUFF'
  | 'MANUAL_HEALTHKIT'
  | 'MANUAL_SWI'
  | 'DERIVED'

export type MetricState<T> = {
  value: T | null
  quality: MetricQuality
  /** ISO-8601 da medição; null quando não há valor. */
  measuredAt: string | null
  source: MeasurementSource | null
  unit: string
}

export type BloodPressure = { systolic: number; diastolic: number }

export type WorkerMetrics = {
  heartRate: MetricState<number>
  steps: MetricState<number>
  movementPerMinute: MetricState<number>
  activeEnergy: MetricState<number>
  energyRatePerHour: MetricState<number> & { calculating: boolean }
  battery: MetricState<number>
  bloodPressure: MetricState<BloodPressure>
  /** 0-100. */
  effort: MetricState<number>
  /** 0-100. */
  wear: MetricState<number>
  /** Acumulado do dia, em metros. */
  distance: MetricState<number>
  /** Medição pontual: "última medição às", nunca "atual". */
  oxygenSaturation: MetricState<number>
  /** Minutos até o alerta de desgaste no ritmo recente. */
  fatigueEtaMin: MetricState<number>
}

export type WorkerTelemetry = {
  workerId: string
  /** Null enquanto o funcionário nunca reportou. */
  origin: TelemetryOrigin | null
  monitoringSessionId: string | null
  metrics: WorkerMetrics
  bloodPressureRecency: 'CURRENT' | 'HISTORICAL' | 'NONE'
  formulaVersion: string | null
  /** ISO-8601 do instante contra o qual a qualidade foi decidida. */
  observedAt: string
}

export const telemetryApi = {
  // Quem nunca reportou volta como leitura vazia, não como erro: erro aqui é
  // funcionário fora da empresa, sessão caída ou backend fora do ar.
  workerCurrent: async (workerId: string): Promise<ServiceResponse<WorkerTelemetry>> => {
    try {
      const data = await apiFetch<WorkerTelemetry>(
        `/telemetry/v1/workers/${encodeURIComponent(workerId)}/current`,
      )
      return { data, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao carregar a telemetria' },
      }
    }
  },
}
