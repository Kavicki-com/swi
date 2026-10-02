// O que os donuts de saúde e a lista de desgaste do dashboard mostram,
// decidido a partir da leitura real do backend. Funções puras: a tela só
// desenha o que sai daqui.
//
// Nenhum limiar é inventado aqui. Saúde só deixa de ser boa quando o motor de
// condições do backend abre uma condição; "desgastando" é quem o backend diz
// que chega ao alerta de desgaste no ritmo atual (minutos até a fadiga).
import type {
  AdminTelemetrySummary,
  AdminWorkersTelemetry,
  WorkerTelemetry,
} from '@/services/api/telemetry'
import { healthStatusFrom } from '@/services/vitals/healthStatus'
import { NO_VALUE } from '@/services/vitals/vitalsView'

export type HealthDonut = {
  value: number | string
  /** Preenchimento 0-100: a fração da população que o número representa. */
  progress: number
  caption: string
}

export type HealthDonuts = {
  vitalSigns: HealthDonut
  wear: HealthDonut
  urgentAlerts: HealthDonut
}

/** Faixa da aba de desgaste; null para quem não tem leitura atual. */
export type WearTier = 'excelente' | 'desgastado' | 'alerta-fadiga'

export type WearRow = {
  id: string
  employeeName: string
  sector: string
  avatarUri?: string
  /** Desgaste 0-100 arredondado; ausente sem avaliação. */
  progress?: number
  /** Batimento; null quando não há leitura nem condição que o tenha medido. */
  bpm: number | null
  pressure: string | null
  tier: WearTier | null
  /** Leitura de origem demonstração, rotulada na tela. */
  demo: boolean
  /** Tem aparelho pareado; sem nenhum pareado, a lista mostra o estado vazio. */
  paired: boolean
}

// Legenda do resumo quando ninguém tem leitura que entre na conta.
const NO_COVERAGE = 'Sem dados atuais'
const LOW_WEAR = 'Desgaste baixo'

const ratio = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

const hasWearAlert = (t: WorkerTelemetry) => t.conditions.some((c) => c.kind === 'WEAR_HIGH')

export function healthDonuts(
  summary: AdminTelemetrySummary,
  workers: AdminWorkersTelemetry,
): HealthDonuts {
  const vital = summary.vitalSigns
  const urgent = summary.urgentAlerts

  // O resumo não conta demonstração; o donut de desgaste segue a mesma régua
  // para os três números falarem da mesma população. Quem ainda não reportou
  // está na população, só não foi avaliado.
  const population = workers.workers.filter((w) => w.telemetry.origin !== 'DEMO')
  const wearEvaluated = population.filter((w) => w.telemetry.metrics.wear.quality === 'CURRENT')
  const lowWear = wearEvaluated.filter((w) => !hasWearAlert(w.telemetry)).length

  return {
    vitalSigns:
      vital.value === null
        ? { value: NO_VALUE, progress: 0, caption: vital.caption }
        : {
            value: vital.value,
            progress: ratio(vital.value, vital.coverage.total),
            caption: vital.caption,
          },
    wear:
      wearEvaluated.length === 0
        ? { value: NO_VALUE, progress: 0, caption: NO_COVERAGE }
        : { value: lowWear, progress: ratio(lowWear, population.length), caption: LOW_WEAR },
    urgentAlerts:
      urgent.total === 0
        ? { value: NO_VALUE, progress: 0, caption: urgent.caption }
        : {
            value: urgent.workers,
            progress: ratio(urgent.workers, urgent.total),
            caption: urgent.caption,
          },
  }
}

/** Os três donuts sem número, enquanto a leitura carrega ou depois de falhar. */
export function unavailableDonuts(caption: string): HealthDonuts {
  const empty = { value: NO_VALUE, progress: 0, caption }
  return { vitalSigns: empty, wear: empty, urgentAlerts: empty }
}

// A faixa parte da régua única de estado de saúde: condição urgente ou de
// saúde aberta pede atenção agora, e sem leitura atual a pessoa fica fora das
// abas. Entre quem está bem, a estimativa de fadiga separa as duas faixas.
function tierOf(t: WorkerTelemetry): WearTier | null {
  const status = healthStatusFrom(t)
  if (status === 'low' || status === 'alert') return 'alerta-fadiga'
  if (status === 'unknown') return null
  if (t.metrics.fatigueEtaMin.value !== null) return 'desgastado'
  return 'excelente'
}

// Sem leitura de batimento, o valor que abriu a condição de batimento ainda é
// uma medição real e diz mais que a ausência.
function bpmOf(t: WorkerTelemetry): number | null {
  if (t.metrics.heartRate.value !== null) return Math.round(t.metrics.heartRate.value)
  const opened = t.conditions.find(
    (c) =>
      (c.kind === 'HEART_RATE_HIGH' || c.kind === 'HEART_RATE_LOW') && c.observedValue !== null,
  )
  return opened?.observedValue != null ? Math.round(opened.observedValue) : null
}

export function wearRows(
  workers: AdminWorkersTelemetry,
  avatars: Readonly<Record<string, string | undefined>>,
): WearRow[] {
  // A ordem é a do backend: condição urgente primeiro, depois saúde, depois o
  // resto por nome.
  return workers.workers.map(({ worker, device, telemetry }) => {
    const { wear, bloodPressure } = telemetry.metrics
    return {
      id: worker.id,
      employeeName: worker.name,
      sector: worker.sector ?? '',
      avatarUri: avatars[worker.id] || undefined,
      progress:
        wear.value === null ? undefined : Math.round(Math.min(100, Math.max(0, wear.value))),
      bpm: bpmOf(telemetry),
      pressure:
        bloodPressure.value === null
          ? null
          : `${bloodPressure.value.systolic}/${bloodPressure.value.diastolic}`,
      tier: tierOf(telemetry),
      demo: telemetry.origin === 'DEMO',
      paired: device.state === 'PAIRED',
    }
  })
}
