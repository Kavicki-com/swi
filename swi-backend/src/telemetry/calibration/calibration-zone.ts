import type { CalibrationMetric } from '@prisma/client'
import { HIGHER_IS_WORSE, type Cuts } from './calibration-bands'

// Onde um valor cai na faixa da pessoa. É o que o painel pinta em cima da
// leitura atual: excelência, normal ou fadiga para o estado; abaixo, habitual
// ou acima para a atividade. Puro e folha: só a tabela de cortes entra.
//
// Duas regras congeladas:
//
// 1. Corte ausente desliga só a borda dele, nunca inventa zona. Com todos os
//    cortes nulos não há zona, porque não há faixa.
// 2. A borda cai do lado da regra que abre a condição: no "quanto maior,
//    pior" o valor igual ao corte de fadiga JÁ é fadiga (o motor abre Atenção
//    em `>=`), e o igual ao de excelência ainda é excelência.

/** Zona de uma medição de estado: batimento, oxigenação, temperatura, pressão, esforço, desgaste. */
export type StateZone = 'EXCELLENCE' | 'NORMAL' | 'FATIGUE'
/** Zona de uma medição de atividade: passos, distância, calorias, movimento. */
export type ActivityZone = 'BELOW' | 'USUAL' | 'ABOVE'
export type CalibrationZone = StateZone | ActivityZone

/** De onde veio o corte em vigor: partida mínima, aprendido pelo recálculo ou corrigido pelo gestor. */
export type CutsSource = 'START' | 'LEARNED' | 'OVERRIDE'

/** Uma medição como a leitura individual a entrega: a zona de agora e a faixa em vigor. */
export interface CalibrationMetricView {
  /** Nula sem valor atual, sem faixa, ou no total do dia (passos, distância, calorias). */
  zone: CalibrationZone | null
  cuts: Cuts
  source: CutsSource
}

/** A calibração do funcionário como a leitura individual a entrega. */
export interface WorkerCalibrationView {
  version: string
  /** CALIBRATED quando a fase fechou os 30 dias válidos. */
  phase: 'CALIBRATING' | 'CALIBRATED'
  /** Fase reaberta por troca de aparelho: a faixa de antes é a partida. */
  recalibrating: boolean
  /** Dia N de 30 enquanto calibra; nulo depois. */
  day: number | null
  /** Só as faixas gravadas e legíveis; a medição sem faixa fica ausente. */
  metrics: Partial<Record<CalibrationMetric, CalibrationMetricView>>
}

const ACTIVITY: ReadonlySet<CalibrationMetric> = new Set<CalibrationMetric>(['STEPS', 'DISTANCE', 'ACTIVE_ENERGY', 'MOVEMENT'])

const cut = (cuts: Cuts, key: string): number | null => cuts[key] ?? null

/**
 * Temperatura tem dois lados: fora de p10..p90 é fadiga, dentro de p25..p75
 * (inclusive) é excelência, o resto é normal. Corte ausente desliga só a
 * borda dele: sem p90 não há fadiga por cima, sem p25 a excelência desce até
 * p10. Na prática só a correção do gestor chega aqui incompleta, porque o
 * recálculo zera os quatro juntos quando saem fora de ordem.
 */
function temperatureZone(value: number, cuts: Cuts): StateZone | null {
  const [p10, p25, p75, p90] = [cut(cuts, 'p10'), cut(cuts, 'p25'), cut(cuts, 'p75'), cut(cuts, 'p90')]
  if (p10 === null && p25 === null && p75 === null && p90 === null) return null
  if ((p10 !== null && value < p10) || (p90 !== null && value > p90)) return 'FATIGUE'
  if ((p25 === null || value >= p25) && (p75 === null || value <= p75)) return 'EXCELLENCE'
  return 'NORMAL'
}

function activityZone(value: number, cuts: Cuts): ActivityZone | null {
  const [below, above] = [cut(cuts, 'below'), cut(cuts, 'above')]
  if (below === null && above === null) return null
  if (below !== null && value < below) return 'BELOW'
  if (above !== null && value > above) return 'ABOVE'
  return 'USUAL'
}

/** Oxigenação: quanto menor, pior. Fadiga abaixo do corte; excelência a partir do dela. */
function lowerIsWorseZone(value: number, cuts: Cuts): StateZone | null {
  const [excellence, fatigue] = [cut(cuts, 'excellence'), cut(cuts, 'fatigue')]
  if (excellence === null && fatigue === null) return null
  if (fatigue !== null && value < fatigue) return 'FATIGUE'
  if (excellence !== null && value >= excellence) return 'EXCELLENCE'
  return 'NORMAL'
}

/** Batimento, pressão, esforço e desgaste: fadiga a partir do corte; excelência até o dela. */
function higherIsWorseZone(value: number, cuts: Cuts): StateZone | null {
  const [excellence, fatigue] = [cut(cuts, 'excellence'), cut(cuts, 'fatigue')]
  if (excellence === null && fatigue === null) return null
  if (fatigue !== null && value >= fatigue) return 'FATIGUE'
  if (excellence !== null && value <= excellence) return 'EXCELLENCE'
  return 'NORMAL'
}

export function zoneOf(metric: CalibrationMetric, value: number | null, cuts: Cuts | null): CalibrationZone | null {
  if (value === null || cuts === null) return null
  if (metric === 'BODY_TEMPERATURE') return temperatureZone(value, cuts)
  if (ACTIVITY.has(metric)) return activityZone(value, cuts)
  if (HIGHER_IS_WORSE.has(metric)) return higherIsWorseZone(value, cuts)
  return lowerIsWorseZone(value, cuts)
}

const STATE_RANK: Readonly<Record<StateZone, number>> = { EXCELLENCE: 0, NORMAL: 1, FATIGUE: 2 }

/**
 * A pior de duas zonas de estado, para quem combina sistólica e diastólica
 * numa pressão só. Zona ausente é ignorada: ela não puxa para nenhum lado.
 */
export function worseZone(a: StateZone | null, b: StateZone | null): StateZone | null {
  if (a === null) return b
  if (b === null) return a
  return STATE_RANK[a] >= STATE_RANK[b] ? a : b
}
