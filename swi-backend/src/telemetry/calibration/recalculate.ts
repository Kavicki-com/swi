import type { CalibrationDeviceFamily, CalibrationMetric } from '@prisma/client'
import {
  CALIBRATION_METRICS,
  FULL_DAYS,
  PEAK_PERCENTILE,
  isValidDay,
  nextCut,
  nextCuts,
  nullCuts,
  personalCuts,
  startCuts,
  type CalibrationDay,
  type Cuts,
} from './calibration-bands'
import { median, percentile } from './percentile'

// Recálculo diário de um funcionário. Puro: o serviço lê a calibração gravada
// e os Resumos, chama daqui e grava o resultado.

export interface StoredBand {
  validDays: number
  start: Cuts
  learned: Cuts
}

export interface StoredCalibration {
  deviceFamily: CalibrationDeviceFamily
  phaseStartedAt: Date
  recalibrating: boolean
  peakBpm: number | null
  /** Partida do pico guardada na fase (máxima por idade ou pico antes da troca). */
  peakStartBpm: number | null
  bands: Partial<Record<CalibrationMetric, StoredBand>>
}

export interface RecalculateInput {
  previous: StoredCalibration | null
  /** Resumos REAIS de dias terminados, desde antes da fase. */
  days: readonly CalibrationDay[]
  /** 208 - 0,7 x idade de hoje; nula sem data de nascimento. */
  maxBpmByAge: number | null
}

export interface RecalculateResult {
  deviceFamily: CalibrationDeviceFamily
  phaseStartedAt: Date
  recalibrating: boolean
  /** A fase começou agora por troca de família. */
  deviceChanged: boolean
  validDays: number
  restingBpm: number | null
  peakBpm: number | null
  peakPersonalBpm: number | null
  peakStartBpm: number | null
  bands: Record<CalibrationMetric, StoredBand>
}

/** De onde a fase parte e o que ela herda do recálculo de ontem. */
interface Phase {
  startedAt: Date
  recalibrating: boolean
  deviceChanged: boolean
  startOf: (metric: CalibrationMetric) => Cuts
  peakStartBpm: number | null
  /** O aprendido de ontem; nulo quando a fase é nova. */
  learnedOf: (metric: CalibrationMetric) => Cuts | null
  previousPeakBpm: number | null
}

/** A família atual: a do dia válido de batimento mais recente, senão a do mais recente que tem uma. */
function currentFamily(days: readonly CalibrationDay[]): CalibrationDeviceFamily | null {
  const valid = days.find((d) => d.deviceFamily !== null && isValidDay('HEART_RATE', d))
  return (valid ?? days.find((d) => d.deviceFamily !== null))?.deviceFamily ?? null
}

/**
 * Primeiro dia do trecho mais recente da família: volta no tempo até um dia de
 * outra família. Dia sem família (sem batimento) não interrompe o trecho.
 */
function stretchStart(days: readonly CalibrationDay[], family: CalibrationDeviceFamily): Date | null {
  let start: Date | null = null
  for (const d of days) {
    if (d.deviceFamily === null) continue
    if (d.deviceFamily !== family) {
      if (start !== null) break
      continue
    }
    start = d.day
  }
  return start
}

function phaseOf(
  previous: StoredCalibration | null,
  family: CalibrationDeviceFamily,
  days: readonly CalibrationDay[],
  maxBpmByAge: number | null,
): Phase {
  const minimum = (metric: CalibrationMetric) => startCuts(metric, maxBpmByAge)
  const fresh = { learnedOf: () => null, previousPeakBpm: null }

  if (previous === null) {
    // `family` veio de um dia com família, então o trecho existe.
    const startedAt = stretchStart(days, family) ?? days[0].day
    return { ...fresh, startedAt, recalibrating: false, deviceChanged: false, startOf: minimum, peakStartBpm: maxBpmByAge }
  }

  if (previous.deviceFamily !== family) {
    // Troca de aparelho: tudo o que a pessoa já tinha aprendido vira a partida
    // da fase nova, inclusive os cortes sem partida (atividade).
    const startedAt = stretchStart(days, family) ?? days[0].day
    return {
      ...fresh,
      startedAt,
      recalibrating: true,
      deviceChanged: true,
      startOf: (metric) => previous.bands[metric]?.learned ?? minimum(metric),
      peakStartBpm: previous.peakBpm ?? maxBpmByAge,
    }
  }

  // Mesma fase. Na inicial a partida segue a regra com a idade de hoje (a data
  // de nascimento pode ter chegado depois); na de recalibração, a guardada.
  return {
    startedAt: previous.phaseStartedAt,
    recalibrating: previous.recalibrating,
    deviceChanged: false,
    startOf: previous.recalibrating ? (metric) => previous.bands[metric]?.start ?? minimum(metric) : minimum,
    peakStartBpm: previous.recalibrating ? (previous.peakStartBpm ?? maxBpmByAge) : maxBpmByAge,
    learnedOf: (metric) => previous.bands[metric]?.learned ?? null,
    previousPeakBpm: previous.peakBpm,
  }
}

const recentWindow = (days: readonly CalibrationDay[]) => days.slice(0, FULL_DAYS)

const valuesOf = (days: readonly CalibrationDay[], pick: (d: CalibrationDay) => number | null) =>
  days.flatMap((d) => {
    const v = pick(d)
    return v === null ? [] : [v]
  })

export function recalculate(input: RecalculateInput): RecalculateResult | null {
  const { previous, maxBpmByAge } = input
  const days = [...input.days].sort((a, b) => b.day.getTime() - a.day.getTime())

  const family = currentFamily(days) ?? previous?.deviceFamily ?? null
  if (family === null) return null
  const phase = phaseOf(previous, family, days, maxBpmByAge)

  // Dias da fase: desde o começo dela, sem os da outra família.
  const phaseDays = days.filter(
    (d) => d.day.getTime() >= phase.startedAt.getTime() && (d.deviceFamily === null || d.deviceFamily === family),
  )

  const bands = {} as Record<CalibrationMetric, StoredBand>
  for (const metric of CALIBRATION_METRICS) {
    const valid = phaseDays.filter((d) => isValidDay(metric, d))
    const recent = recentWindow(valid)
    const personal = recent.length === 0 ? nullCuts(metric) : personalCuts(metric, recent)
    const start = phase.startOf(metric)
    bands[metric] = { validDays: valid.length, start, learned: nextCuts(metric, valid.length, personal, start, phase.learnedOf(metric)) }
  }

  const heartRateWindow = recentWindow(phaseDays.filter((d) => isValidDay('HEART_RATE', d)))
  const validDays = bands.HEART_RATE.validDays
  const peakPersonalBpm = percentile(
    valuesOf(heartRateWindow, (d) => d.heartRateMax),
    PEAK_PERCENTILE,
  )

  return {
    deviceFamily: family,
    phaseStartedAt: phase.startedAt,
    recalibrating: phase.recalibrating,
    deviceChanged: phase.deviceChanged,
    validDays,
    restingBpm: median(valuesOf(heartRateWindow, (d) => d.heartRateMin)),
    peakBpm: nextCut(validDays, peakPersonalBpm, phase.peakStartBpm, phase.previousPeakBpm),
    peakPersonalBpm,
    peakStartBpm: phase.peakStartBpm,
    bands,
  }
}
