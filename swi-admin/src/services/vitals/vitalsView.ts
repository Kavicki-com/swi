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
  /** Selo da leitura: demonstração, atraso da pulseira ou estimativa provisória. */
  sourceBadge: string | null
  /** Rótulo da rosca de fadiga: "Fadiga atual", ou com o instante medido. */
  wearLabel: string
  /** Rótulo da rosca de esforço: "Esforço feito", ou com o instante medido. */
  effortLabel: string
}

export const DEMO_DATA_LABEL = 'Dados de demonstração'

/** Rótulos das roscas quando a leitura é ao vivo: o valor é de agora. */
export const WEAR_LABEL = 'Fadiga atual'
export const EFFORT_LABEL = 'Esforço feito'

/**
 * Instante sem o "às" na frente ("Dados até 14:10", "Dados até 30/09 às
 * 14:10"), a mesma convenção do app no celular. Reaproveita o whenLabel para a
 * data e o dia seguirem a mesma regra do resto do painel.
 */
const untilLabel = (iso: string, now: number): string | null =>
  whenLabel(iso, now)?.replace(/^(às|em) /, '') ?? null

/**
 * Selo de atraso da pulseira lida pelo Health Connect. O lote chega depois e
 * vale até o último instante medido, não até agora: sem dizer isso, um esforço
 * de duas horas atrás pareceria o de agora. measuredUntil é relógio do celular,
 * syncedAt é relógio do servidor; o painel mostra os dois no relógio de quem olha.
 */
const syncBadgeOf = (telemetry: WorkerTelemetry, now: number): string | null => {
  if (!telemetry.sync) return null
  const until = untilLabel(telemetry.sync.measuredUntil, now)
  const synced = whenLabel(telemetry.sync.syncedAt, now)
  if (until === null || synced === null) return null
  return `Dados até ${until}, sincronizado ${synced}`
}

/**
 * Esforço e desgaste calculados com repouso provisório, antes do primeiro dia
 * de uso fechar. O número existe e vale, mas ainda vai se ajustar.
 */
export const PROVISIONAL_BASELINE_LABEL = 'Estimativa provisória'

/**
 * Selo da leitura. Demonstração vence: um dado que nem é real não precisa
 * dizer até quando foi medido nem que é estimativa. Depois vem o atraso da
 * pulseira, porque um dado velho apresentado como atual engana mais do que um
 * repouso ainda provisório. O provisório só faz sentido com desgaste na tela.
 * `now` é o relógio da tela, para o selo envelhecer junto com a página.
 */
export function sourceBadgeOf(telemetry: WorkerTelemetry, now: number = Date.now()): string | null {
  if (telemetry.origin === 'DEMO') return DEMO_DATA_LABEL
  const sync = syncBadgeOf(telemetry, now)
  if (sync !== null) return sync
  if (telemetry.baseline === 'PROVISIONAL' && telemetry.metrics.wear.value !== null)
    return PROVISIONAL_BASELINE_LABEL
  return null
}

/** Marcador de valor ausente na tela. */
export const NO_VALUE = '--'

/** Frase de quem não tem relógio pareado, a mesma em todas as telas. */
export const NO_DEVICE_LABEL = 'Sem relógio pareado'

/** Ainda sem saber se há relógio pareado. */
export const CHECKING_DEVICE_LABEL = 'Verificando o relógio…'

/** A consulta falhou: não dá para afirmar que falta leitura. */
export const READING_UNAVAILABLE_LABEL = 'Leitura indisponível no momento'

/** Nenhuma leitura do aparelho, ou quem nunca reportou. */
export const NO_READING_LABEL = 'Sem leitura do aparelho'

const oneDecimal = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10

const NO_ESTIMATE = { minutes: null, label: 'Sem estimativa' }

const EMPTY: Omit<WorkerVitalsView, 'status'> = {
  heartRate: null,
  pressure: null,
  wearPct: null,
  effortPct: null,
  fatigueEta: NO_ESTIMATE,
  sourceBadge: null,
  wearLabel: WEAR_LABEL,
  effortLabel: EFFORT_LABEL,
}

/**
 * Rótulo da rosca com a pulseira: o esforço e o desgaste valem para o fim da
 * janela avaliada (measuredAt da métrica, ou o fim dos dados sincronizados),
 * então o rótulo diz esse instante e perde o "atual". Ao vivo, fica o padrão.
 * Sem valor, também fica o padrão: "--" ao lado de um horário sugeriria uma
 * medição vazia naquele instante (o app no celular segue a mesma regra). Um
 * sync com data inválida não ganha selo, então também não muda o rótulo.
 */
const measuredLabel = (
  prefix: string,
  fallback: string,
  metric: { value: number | null; measuredAt: string | null },
  telemetry: WorkerTelemetry,
  now: number,
): string => {
  if (!telemetry.sync || metric.value === null || syncBadgeOf(telemetry, now) === null)
    return fallback
  const when = whenLabel(metric.measuredAt ?? telemetry.sync.measuredUntil, now)
  return when === null ? fallback : `${prefix} ${when}`
}

/**
 * Como decidir o que a leitura mostra, as mesmas opções para vitais e medições
 * do relógio: assim uma faixa nunca mostra a leitura guardada que a outra esconde.
 */
export type ReadingOptions = {
  /** Sem relógio pareado: a leitura guardada não vale. */
  noDevice?: boolean
  /** Ainda sem saber se há relógio: a leitura guardada espera. */
  deviceUnknown?: boolean
  /** A consulta falhou. */
  failed?: boolean
  /** Relógio da tela, para "Última leitura às 14:32" envelhecer com a página. */
  now?: number
}

export function vitalsViewFrom(
  telemetry: WorkerTelemetry | null,
  options: ReadingOptions = {},
): WorkerVitalsView {
  // Sem aparelho pareado, a leitura guardada não vale: desparear não apaga o
  // último snapshot no backend, e mostrá-lo seria apresentar dado velho como atual.
  if (options.noDevice) return { ...EMPTY, status: NO_DEVICE_LABEL }
  // Sem saber ainda se há relógio, a leitura guardada pode ser de quem já
  // despareou: ela espera a resposta, ou some se a resposta não vier.
  if (options.deviceUnknown) {
    return {
      ...EMPTY,
      status: options.failed ? READING_UNAVAILABLE_LABEL : CHECKING_DEVICE_LABEL,
    }
  }

  if (telemetry === null || telemetry.origin === null) {
    return {
      ...EMPTY,
      status: options.failed ? READING_UNAVAILABLE_LABEL : NO_READING_LABEL,
    }
  }

  const { heartRate, bloodPressure, wear, effort, fatigueEtaMin } = telemetry.metrics
  const now = options.now ?? Date.now()

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
            `Última leitura ${whenLabel(heartRate.measuredAt, now)}`
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
    sourceBadge: sourceBadgeOf(telemetry, now),
    wearLabel: measuredLabel('Fadiga', WEAR_LABEL, wear, telemetry, now),
    effortLabel: measuredLabel('Esforço feito', EFFORT_LABEL, effort, telemetry, now),
  }
}
