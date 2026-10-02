// O que o bloco de vitais do detalhe mostra, decidido a partir da leitura do
// backend. Função pura: a tela só desenha o que sai daqui. Ausência continua
// ausência (null), para a tela escrever NO_VALUE em vez de inventar um zero, e a
// frase de estado descreve a leitura, não a saúde: juízo de saúde depende das
// condições do backend, que esta leitura ainda não traz.
import type { WorkerTelemetry } from '@/services/api/telemetry'

export type WorkerVitalsView = {
  /** Batimento já formatado, ou null sem leitura. */
  heartRate: string | null
  /** "sistólica/diastólica", ou null sem medição. */
  pressure: string | null
  /** Desgaste 0-100 com uma casa, ou null. */
  wearPct: number | null
  /** Esforço 0-100 com uma casa, ou null. */
  effortPct: number | null
  fatigueEta: { minutes: number | null; label: string }
  /** Frase do cartão: em que pé está a leitura. */
  status: string
  /** Selo de origem quando a leitura não é do relógio real. */
  sourceBadge: string | null
}

export const DEMO_DATA_LABEL = 'Dados de demonstração'

/** Marcador de valor ausente na tela. */
export const NO_VALUE = '--'

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

const oneDecimal = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10

const NO_ESTIMATE = { minutes: null, label: 'Sem estimativa' }

const EMPTY: Omit<WorkerVitalsView, 'status'> = {
  heartRate: null,
  pressure: null,
  wearPct: null,
  effortPct: null,
  fatigueEta: NO_ESTIMATE,
  sourceBadge: null,
}

export function vitalsViewFrom(
  telemetry: WorkerTelemetry | null,
  options: { noDevice?: boolean; failed?: boolean } = {},
): WorkerVitalsView {
  if (telemetry === null || telemetry.origin === null) {
    return {
      ...EMPTY,
      status: options.noDevice
        ? 'Sem aparelho'
        : options.failed
          ? 'Leitura indisponível no momento'
          : 'Sem leitura do aparelho',
    }
  }

  const { heartRate, bloodPressure, wear, effort, fatigueEtaMin } = telemetry.metrics

  // A qualidade já chega decidida pelo backend contra o instante da leitura;
  // a tela não recalcula frescor com o próprio relógio.
  const status =
    heartRate.value === null
      ? 'Sem leitura recente'
      : heartRate.quality === 'CURRENT'
        ? 'Monitorando agora'
        : heartRate.measuredAt
          ? `Última leitura às ${clock(heartRate.measuredAt)}`
          : 'Sem leitura recente'

  // Avaliação presente sem estimativa quer dizer que o ritmo recente não leva
  // ao limiar do alerta dentro do horizonte da fórmula.
  const etaMinutes = fatigueEtaMin.value === null ? null : Math.round(fatigueEtaMin.value)
  const fatigueEta =
    etaMinutes !== null
      ? { minutes: etaMinutes, label: `${etaMinutes} minutos` }
      : wear.value !== null
        ? { minutes: null, label: 'Sem previsão de fadiga no ritmo atual' }
        : NO_ESTIMATE

  return {
    heartRate: heartRate.value === null ? null : String(Math.round(heartRate.value)),
    pressure:
      bloodPressure.value === null
        ? null
        : `${bloodPressure.value.systolic}/${bloodPressure.value.diastolic}`,
    wearPct: wear.value === null ? null : oneDecimal(wear.value),
    effortPct: effort.value === null ? null : oneDecimal(effort.value),
    fatigueEta,
    status,
    sourceBadge: telemetry.origin === 'DEMO' ? DEMO_DATA_LABEL : null,
  }
}
