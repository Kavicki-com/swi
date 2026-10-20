import type { Prisma } from '@prisma/client'
import type {
  ProvisionalRestingFrom as WrittenProvisionalFrom,
  RestingSource as WrittenRestingSource,
} from '../assessment/assessment-baseline'

// O repouso e a máxima calculados na avaliação, lidos do JSON de entradas.
// Quem grava é o serviço de avaliação; aqui só se lê, e com desconfiança:
// linha antiga ou de outra versão da fórmula pode não ter o formato de hoje, e
// aí a resposta é "sem referência", nunca um erro.
//
// Módulo folha de propósito: a projeção importa daqui, e nada aqui importa da
// projeção. Do lado que grava só vêm tipos, para o vocabulário das duas pontas
// ser conferido pelo compilador sem dependência de execução.

/**
 * De onde veio o repouso: medido na mediana dos dias fechados, ou provisório
 * enquanto não há dia fechado. O mesmo vocabulário da coluna da avaliação.
 */
export type BaselineSource = 'MEASURED' | 'PROVISIONAL'

/** De onde veio o repouso provisório, no vocabulário da leitura. */
export type RestingProvisionalOrigin = 'OPEN_DAY' | 'SESSION' | 'DEFAULT'

export interface HeartRateReference {
  /**
   * Repouso calculado na avaliação, em bpm. A fórmula só o usa quando há
   * máxima; sem data de nascimento ele vem mesmo assim.
   */
  restingBpm: number
  restingSource: BaselineSource
  /** Só no provisório: dia em andamento, a própria sessão ou o padrão. */
  provisionalFrom: RestingProvisionalOrigin | null
  /** Dias terminados que entraram na mediana; zero no provisório. */
  measuredDays: number
  /** Máxima estimada pela idade, uma casa. Nula sem data de nascimento. */
  maxBpm: number | null
  /** Instante da avaliação de onde a referência saiu. */
  computedAt: string
}

// O `satisfies` amarra a tabela à união que o serviço de avaliação grava: uma
// origem nova do lado de lá deixa de compilar aqui, em vez de virar "sem
// referência" em silêncio. O Map, e não o objeto, faz a busca: num objeto,
// "toString" e outros nomes herdados de Object.prototype casariam com a chave.
const PROVISIONAL_ORIGINS = {
  open_day: 'OPEN_DAY',
  session: 'SESSION',
  default: 'DEFAULT',
} as const satisfies Record<WrittenProvisionalFrom, RestingProvisionalOrigin>
const PROVISIONAL_FROM = new Map<unknown, RestingProvisionalOrigin>(Object.entries(PROVISIONAL_ORIGINS))

const MEASURED: WrittenRestingSource = 'measured'
const PROVISIONAL: WrittenRestingSource = 'provisional'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
// Medido é sempre a mediana de pelo menos um dia terminado.
const isDayCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
// A máxima é 208 - 0,7 * idade em ponto flutuante: sem o arredondamento, 33
// anos chegariam ao painel como 184.89999999999998.
const round1 = (n: number): number => Math.round(n * 10) / 10

export function heartRateReferenceOf(
  inputs: Prisma.JsonValue | null,
  computedAt: string,
): HeartRateReference | null {
  if (!isRecord(inputs)) return null
  const baseline = inputs.baseline
  if (!isRecord(baseline) || !isNumber(baseline.restingBpm)) return null

  let restingSource: BaselineSource
  let provisionalFrom: RestingProvisionalOrigin | null = null
  let measuredDays = 0
  if (baseline.source === MEASURED) {
    // Medido sem contagem de dias válida não é o formato que o serviço grava.
    if (!isDayCount(baseline.days)) return null
    restingSource = 'MEASURED'
    measuredDays = baseline.days
  } else if (baseline.source === PROVISIONAL) {
    // Provisório sem origem conhecida também é recusado: dizer "provisório"
    // sem saber de onde veio é meia informação, e a tela não teria o que
    // explicar.
    const origin = PROVISIONAL_FROM.get(baseline.provisionalFrom)
    if (origin === undefined) return null
    restingSource = 'PROVISIONAL'
    provisionalFrom = origin
  } else {
    return null
  }

  return {
    restingBpm: baseline.restingBpm,
    restingSource,
    provisionalFrom,
    measuredDays,
    maxBpm: isNumber(baseline.maxBpm) ? round1(baseline.maxBpm) : null,
    computedAt,
  }
}
