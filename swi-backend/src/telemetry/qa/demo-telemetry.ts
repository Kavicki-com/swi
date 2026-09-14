import { randomUUID } from 'node:crypto'
import type { Segment } from '../assessment/fatigue-simulator'

// Parte pura do script de homologação: um cenário de segmentos vira lotes no
// formato exato que a ingestão aceita. Não toca banco nem Nest, e por isso é
// o que se testa.
//
// Por que existe: o alerta de desgaste foi desenhado para ser raro num turno
// normal. Sem um jeito de provocá-lo, o cliente homologa alertas sem nunca
// ter visto um. Isto NÃO é um gerador de demonstração como recurso: é uma
// ferramenta de homologação, e a origem DEMO em todo evento é o rótulo que impede o
// dado injetado de ser confundido com real, no read model e na tela.

export interface DemoScenario {
  cadenceSec: number
  /** [segundos, bpm ou null, picos por minuto ou null], como no simulador. */
  segments: readonly Segment[]
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
/**
 * O teto de eventos por lote da ingestão (MAX_BATCH_EVENTS em
 * telemetry-batch.dto.ts). Repetido aqui, e não importado, de propósito: o
 * módulo do DTO carrega os decoradores do class-validator, que exigem
 * reflect-metadata, e este módulo é puro para ser testável sem Nest.
 */
const MAX_BATCH_EVENTS = 200

/**
 * Os cenários da varredura de parâmetros da fórmula: repouso, leve, moderado
 * e intenso, 30 minutos cada. `alerta` encadeia moderado e intenso pelo tempo
 * que a varredura mostrou ser preciso para o desgaste cruzar 80% e a condição
 * abrir. Cadência de 5 s, que é a do relógio em sessão.
 */
export const SCENARIOS: Record<'repouso' | 'leve' | 'moderado' | 'intenso' | 'alerta', DemoScenario> = {
  repouso: { cadenceSec: CADENCE_SEC, segments: [[30 * MIN, 66, 2]] },
  leve: { cadenceSec: CADENCE_SEC, segments: [[30 * MIN, 95, 30]] },
  moderado: { cadenceSec: CADENCE_SEC, segments: [[30 * MIN, 125, 54]] },
  intenso: { cadenceSec: CADENCE_SEC, segments: [[30 * MIN, 165, 90]] },
  alerta: {
    cadenceSec: CADENCE_SEC,
    segments: [
      [20 * MIN, 125, 54],
      [90 * MIN, 165, 90],
    ],
  },
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

    // Bateria a cada 3 minutos, contando o primeiro evento, caindo devagar.
    if (elapsedSec % (3 * MIN) === 0) {
      measurements.battery = measurement(round3(100 - (elapsedSec / MIN) * 0.05), '%')
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
