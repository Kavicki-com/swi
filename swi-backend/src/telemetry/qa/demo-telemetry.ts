import { randomUUID } from 'node:crypto'
import type { Segment } from '../assessment/fatigue-simulator'
import { monitoredDayOf } from '../domain/metric-state'
import { SUMMARIZER_VERSION } from '../lifecycle/telemetry-summarizer'

// Parte pura do script de homologação: um cenário de segmentos vira lotes no
// formato exato que a ingestão aceita, e a base de repouso vira linhas de
// resumo do dia. Não toca banco nem Nest, e por isso é o que se testa.
//
// Por que existe: as condições do piloto foram desenhadas para serem raras
// num turno normal, e sem um jeito de provocá-las o cliente homologa alertas
// sem nunca ter visto um. Isto NÃO é um gerador de demonstração como recurso:
// é uma ferramenta de homologação, e a origem DEMO em todo evento e em toda
// linha de resumo é o rótulo que impede o dado injetado de ser confundido com
// real, no read model, na fórmula e na tela.
//
// Duas regras da ingestão decidem o que o script consegue provocar:
// 1. Só evento AO VIVO (idade até o limiar de desatualizado) dispara avaliação
//    e condições; o que chega com atraso vai ao histórico e não abre nada. Por
//    isso o modo `live` do script é o único que provoca alerta.
// 2. Esforço e desgaste exigem base de repouso (mínimos diários dos últimos 14
//    dias, da MESMA origem) e data de nascimento. `baselineSummaries` cobre a
//    primeira; a segunda vem do seed.

export interface DemoScenario {
  cadenceSec: number
  /** [segundos, bpm ou null, picos por minuto ou null], como no simulador. */
  segments: readonly Segment[]
  /**
   * Bateria fixa em toda leitura de bateria do cenário. Sem isto a bateria
   * começa em 100 e cai devagar. É o que o cenário de bateria baixa usa.
   */
  batteryPercent?: number
}

interface Measurement {
  value: number
  unit: string
  source: 'APPLE_WATCH'
}

// `type`, e nao `interface`, de proposito: interface sem assinatura de indice
// nao e atribuivel ao Record<string, unknown> do DTO, e o script entrega isto
// direto a ingestao.
export type DemoMeasurements = {
  heartRate?: Measurement
  stepDelta?: Measurement
  activeEnergyKcal?: Measurement
  motionCount?: Measurement
  battery?: Measurement
}

export interface DemoEvent {
  eventId: string
  monitoringSessionId: string
  sequence: number
  eventTime: string
  origin: 'DEMO'
  measurements: DemoMeasurements
}

export interface DemoBatch {
  events: DemoEvent[]
}

const CADENCE_SEC = 5
const MIN = 60
const DAY_MS = 24 * 60 * 60 * 1000
/**
 * O teto de eventos por lote da ingestão (MAX_BATCH_EVENTS em
 * telemetry-batch.dto.ts). Repetido aqui, e não importado, de propósito: o
 * módulo do DTO carrega os decoradores do class-validator, que exigem
 * reflect-metadata, e este módulo é puro para ser testável sem Nest.
 */
const MAX_BATCH_EVENTS = 200

export type ScenarioName =
  | 'repouso'
  | 'leve'
  | 'moderado'
  | 'intenso'
  | 'desgaste'
  | 'batimento-alto'
  | 'bateria-baixa'

/**
 * Cenários e o que cada um prova, em modo `live`:
 *
 * - repouso, leve, moderado, intenso: 30 min cada, os quatro da varredura de
 *   parâmetros da fórmula. Mostram esforço e desgaste subindo na tela.
 * - desgaste: 20 min moderado e 90 min intenso, que a varredura mostrou levar
 *   o desgaste acima de 80%. Abre WEAR_HIGH (perfil de alertas v2) e o alerta
 *   de fila correspondente quando o desgaste avaliado chega a 80%; recupera
 *   abaixo de 70%, ou por silêncio. Serve para ver a fórmula no teto e o
 *   alerta que ela promete.
 * - batimento-alto: 3 min a 185 bpm. Abre HEART_RATE_HIGH em cerca de um
 *   minuto (janela de 60 s, sustentado por 45 s): o limiar personalizado é
 *   90% do máximo pela idade, e nunca abaixo de 180.
 * - bateria-baixa: 1 min em repouso com a bateria em 10%. Abre
 *   DEVICE_BATTERY_LOW no primeiro evento (abre em 15%).
 *
 * Cadência de 5 s, que é a do relógio em sessão.
 */
export const SCENARIOS: Record<ScenarioName, DemoScenario> = {
  repouso: { cadenceSec: CADENCE_SEC, segments: [[30 * MIN, 66, 2]] },
  leve: { cadenceSec: CADENCE_SEC, segments: [[30 * MIN, 95, 30]] },
  moderado: { cadenceSec: CADENCE_SEC, segments: [[30 * MIN, 125, 54]] },
  intenso: { cadenceSec: CADENCE_SEC, segments: [[30 * MIN, 165, 90]] },
  desgaste: {
    cadenceSec: CADENCE_SEC,
    segments: [
      [20 * MIN, 125, 54],
      [90 * MIN, 165, 90],
    ],
  },
  'batimento-alto': { cadenceSec: CADENCE_SEC, segments: [[3 * MIN, 185, 90]] },
  'bateria-baixa': { cadenceSec: CADENCE_SEC, segments: [[1 * MIN, 66, 2]], batteryPercent: 10 },
}

export interface BatchesOptions {
  sessionId: string
  /** Instante do último evento. Os anteriores recuam pela cadência. */
  endAt: Date
  maxBatch?: number
}

const APPLE_WATCH = 'APPLE_WATCH' as const
const measurement = (value: number, unit: string): Measurement => ({ value, unit, source: APPLE_WATCH })
const round3 = (n: number): number => Math.round(n * 1000) / 1000

/**
 * Gera os eventos e os divide em lotes do tamanho que a ingestão aceita.
 *
 * O último evento cai em `endAt`, e não o primeiro: é o que faz os últimos
 * eventos serem "atuais" no read model. Um cenário que terminasse no passado
 * seria lido pela tela como indisponível, e a homologação não veria nada.
 */
export function batchesFor(scenario: DemoScenario, options: BatchesOptions): DemoBatch[] {
  const { sessionId, endAt, maxBatch = MAX_BATCH_EVENTS } = options
  const cadenceMs = scenario.cadenceSec * 1000

  // Expande os segmentos em uma leitura por cadência.
  const readings: { bpm: number | null; peaksPerMinute: number | null }[] = []
  for (const [seconds, bpm, peaksPerMinute] of scenario.segments) {
    const count = Math.floor(seconds / scenario.cadenceSec)
    for (let i = 0; i < count; i += 1) readings.push({ bpm, peaksPerMinute })
  }

  const total = readings.length
  const startMs = endAt.getTime() - (total - 1) * cadenceMs

  const events = readings.map(({ bpm, peaksPerMinute }, i): DemoEvent => {
    const elapsedSec = i * scenario.cadenceSec
    const measurements: DemoMeasurements = {}

    // Ausência é ausência: segmento sem batimento não escreve a chave, e
    // nunca escreve zero no lugar.
    if (bpm !== null) {
      measurements.heartRate = measurement(bpm, 'bpm')
      // Energia derivada do batimento, pequena e nunca negativa: esforço
      // intenso dá uns 600 kcal por hora.
      const kcalPerMin = Math.max(0, (bpm - 60) * 0.1)
      measurements.activeEnergyKcal = measurement(round3((kcalPerMin * scenario.cadenceSec) / MIN), 'kcal')
    }

    if (peaksPerMinute !== null) {
      // Contagem no intervalo, não taxa: a fórmula divide pelo intervalo desde
      // o evento anterior. 30 por minuto a cada 5 s são 2,5 por evento.
      const peaks = (peaksPerMinute * scenario.cadenceSec) / MIN
      measurements.motionCount = measurement(peaks, 'count')
      // Passos derivados do movimento, inteiros e não negativos.
      measurements.stepDelta = measurement(Math.round(peaks), 'steps')
    }

    // Bateria a cada 3 minutos, contando o primeiro evento: fixa quando o
    // cenário manda, senão caindo devagar a partir de 100.
    if (elapsedSec % (3 * MIN) === 0) {
      const percent = scenario.batteryPercent ?? round3(100 - (elapsedSec / MIN) * 0.05)
      measurements.battery = measurement(percent, '%')
    }

    return {
      eventId: randomUUID(),
      monitoringSessionId: sessionId,
      sequence: i,
      eventTime: new Date(startMs + i * cadenceMs).toISOString(),
      origin: 'DEMO',
      measurements,
    }
  })

  const batches: DemoBatch[] = []
  for (let i = 0; i < events.length; i += maxBatch) {
    batches.push({ events: events.slice(i, i + maxBatch) })
  }
  return batches
}

export interface BaselineOptions {
  /** Mínimo diário de batimento a semear. 62 é o repouso da varredura. */
  restingBpm?: number
  /** Dias fechados a semear, contando de ontem para trás. 14 é o da fórmula. */
  days?: number
}

/** Uma linha de resumo do dia, no formato da tabela, só com o que a base lê. */
export interface BaselineSummary {
  workerId: string
  day: Date
  origin: 'DEMO'
  heartRateMin: number
  sampleCount: number
  summarizerVersion: string
  computedAt: Date
}

/**
 * A base de repouso que a fórmula exige, como linhas de resumo do dia sob a
 * origem DEMO. A consulta da base filtra pela origem da sessão, então estas
 * linhas alimentam só sessões de demonstração e nunca tocam o real.
 *
 * Dias fechados, de ontem para trás, no dia monitorado (fuso do Brasil), que
 * é o que a fórmula soma. `sampleCount` e a versão do resumidor entram porque
 * a tabela os exige; o valor que importa é o mínimo.
 */
export function baselineSummaries(
  workerId: string,
  now: Date,
  options: BaselineOptions = {},
): BaselineSummary[] {
  const { restingBpm = 62, days = 14 } = options
  const today = monitoredDayOf(now)
  const rows: BaselineSummary[] = []
  for (let k = 1; k <= days; k += 1) {
    rows.push({
      workerId,
      day: new Date(today.getTime() - k * DAY_MS),
      origin: 'DEMO',
      heartRateMin: restingBpm,
      sampleCount: 1,
      summarizerVersion: SUMMARIZER_VERSION,
      computedAt: now,
    })
  }
  return rows
}

/**
 * Gate do script. A mesma regra do simulador de posições: produção nunca, e
 * fora de produção só com a variável ligada de propósito. Chamado antes de
 * qualquer import do Nest, para morrer na primeira linha.
 */
export function assertNotProduction(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Este script nunca roda em produção')
  }
  if (env.QA_DEMO_TELEMETRY !== '1') {
    throw new Error('Defina QA_DEMO_TELEMETRY=1 para injetar telemetria de demonstração')
  }
}
