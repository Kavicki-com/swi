// O que o bloco de vitais do detalhe mostra, decidido a partir da leitura do
// backend. Função pura: a tela só desenha o que sai daqui. Ausência continua
// ausência (null), para a tela escrever NO_VALUE em vez de inventar um zero, e a
// frase de estado descreve a leitura, não a saúde: juízo de saúde depende das
// condições do backend, que esta leitura ainda não traz.
import type { WorkerTelemetry } from '@/services/api/telemetry'
import { whenLabel } from '@/lib/whenLabel'

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

/**
 * Esforço e desgaste calculados com repouso provisório, antes do primeiro dia
 * de uso fechar. O número existe e vale, mas ainda vai se ajustar.
 */
export const PROVISIONAL_BASELINE_LABEL = 'Estimativa provisória'

/**
 * Selo da leitura. Demonstração vence: um dado que nem é real não precisa
 * dizer que é estimativa. O provisório só faz sentido com desgaste na tela.
 */
export function sourceBadgeOf(telemetry: WorkerTelemetry): string | null {
  if (telemetry.origin === 'DEMO') return DEMO_DATA_LABEL
  if (telemetry.baseline === 'PROVISIONAL' && telemetry.metrics.wear.value !== null)
    return PROVISIONAL_BASELINE_LABEL
  return null
}

/** Marcador de valor ausente na tela. */
export const NO_VALUE = '--'

/** Frase de quem não tem relógio pareado, a mesma em todas as telas. */
export const NO_DEVICE_LABEL = 'Sem relógio pareado'

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
  options: { noDevice?: boolean; deviceUnknown?: boolean; failed?: boolean; now?: number } = {},
): WorkerVitalsView {
  // Sem aparelho pareado, a leitura guardada não vale: desparear não apaga o
  // último snapshot no backend, e mostrá-lo seria apresentar dado velho como atual.
  if (options.noDevice) return { ...EMPTY, status: NO_DEVICE_LABEL }
  // Sem saber ainda se há relógio, a leitura guardada pode ser de quem já
  // despareou: ela espera a resposta, ou some se a resposta não vier.
  if (options.deviceUnknown) {
    return {
      ...EMPTY,
      status: options.failed ? 'Leitura indisponível no momento' : 'Verificando o relógio…',
    }
  }

  if (telemetry === null || telemetry.origin === null) {
    return {
      ...EMPTY,
      status: options.failed ? 'Leitura indisponível no momento' : 'Sem leitura do aparelho',
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
          ? // Com a data ("em dd/mm às HH:mm") fora do dia: o backend guarda o
            // último bpm para sempre, e só a hora faria uma leitura de dias
            // atrás parecer de agora.
            `Última leitura ${whenLabel(heartRate.measuredAt, options.now ?? Date.now())}`
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
    sourceBadge: sourceBadgeOf(telemetry),
  }
}
