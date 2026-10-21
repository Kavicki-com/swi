import type { Prisma, TelemetryOrigin } from '@prisma/client'
import { FULL_DAYS, PERSONAL_FROM_DAY } from '../calibration/calibration-bands'
import { monitoredDayOf } from '../domain/metric-state'
import type { Baseline } from './fatigue-formula'

// Linha de base da avaliação: repouso e máxima por idade. A máxima vem do
// perfil, e sem data de nascimento a avaliação sai indisponível (ADR-0009). O
// repouso medido é a mediana dos mínimos dos dias terminados: Resumo
// definitivo do dia fechado ou Resumo provisório de um dia que já passou da
// meia-noite, que a rodada de 30 minutos refaz enquanto chegar leitura
// atrasada. Só o dia em andamento não conta como medido, porque o mínimo dele
// ainda cai conforme o dia passa. Enquanto não existe dia terminado, entra um
// repouso provisório (abaixo), marcado como tal na linha e no painel, para
// esforço e desgaste existirem desde o primeiro uso.

/** Mediana dos mínimos diários de BPM dos dias terminados. Nulo sem dia nenhum. */
export function restingFromDailyMinima(dailyMinima: readonly number[]): number | null {
  if (dailyMinima.length === 0) return null
  const sorted = [...dailyMinima].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Teto do repouso provisório: repouso típico de adulto. Quem já mostrou um
 * piso menor, no dia em andamento ou na própria sessão, fica com o piso; quem só
 * mostrou batimento acima disso fica com o teto, porque um mínimo alto de
 * poucos minutos de uso diz mais sobre a atividade do que sobre o repouso.
 */
export const PROVISIONAL_RESTING_DEFAULT_BPM = 70

/**
 * Chão do repouso provisório, o mesmo do alerta de batimento baixo: abaixo
 * disso é leitura espúria, não repouso, e um único 20 bpm faria o esforço de
 * todo o dia sair inflado.
 */
export const PROVISIONAL_RESTING_FLOOR_BPM = 40

export type RestingSource = 'measured' | 'provisional'
export type ProvisionalRestingFrom = 'open_day' | 'session' | 'default'

export type RestingBaseline =
  | { restingBpm: number; source: 'measured'; days: number }
  | { restingBpm: number; source: 'provisional'; days: 0; from: ProvisionalRestingFrom }

/**
 * O repouso da linha de base. Medido quando há dia terminado com batimento;
 * provisório enquanto não há, pelo menor batimento plausível já visto (Resumo
 * provisório do dia em andamento ou a própria sessão), limitado ao teto padrão.
 */
export function restingBaseline(input: {
  /** Mínimos diários dos dias já terminados, da mesma origem, de Resumo definitivo ou provisório. */
  endedDayMinima: readonly number[]
  /** Mínimo do Resumo provisório do dia em andamento, se houver. */
  openDayMinima: readonly number[]
  /** Menor batimento da própria sessão de monitoramento, se houver. */
  sessionMinBpm: number | null
}): RestingBaseline {
  const measured = restingFromDailyMinima(input.endedDayMinima)
  if (measured !== null) return { restingBpm: measured, source: 'measured', days: input.endedDayMinima.length }

  const plausible = (bpm: number | null): bpm is number => bpm !== null && bpm >= PROVISIONAL_RESTING_FLOOR_BPM
  const openMin = input.openDayMinima.filter(plausible).reduce<number | null>((m, b) => (m === null || b < m ? b : m), null)
  const sessionMin = plausible(input.sessionMinBpm) ? input.sessionMinBpm : null

  let restingBpm = PROVISIONAL_RESTING_DEFAULT_BPM
  let from: ProvisionalRestingFrom = 'default'
  if (openMin !== null && openMin < restingBpm) {
    restingBpm = openMin
    from = 'open_day'
  }
  if (sessionMin !== null && sessionMin < restingBpm) {
    restingBpm = sessionMin
    from = 'session'
  }
  return { restingBpm, source: 'provisional', days: 0, from }
}

/** Anos completos entre a data de nascimento e o dia monitorado de `at`. */
export function ageInYearsAt(birthDate: Date, at: Date): number {
  const today = monitoredDayOf(at)
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear()
  const beforeBirthday =
    today.getUTCMonth() < birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() < birthDate.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}

/** Tanaka, Monahan e Seals (2001). Estimativa respaldada, não medição. */
export function maxHeartRateForAge(ageYears: number): number {
  return 208 - 0.7 * ageYears
}

/**
 * A linha de base inteira de uma avaliação, a partir do que o banco devolveu:
 * repouso (medido ou provisório) e máxima por idade. As duas avaliações, a do
 * relógio e a esparsa da pulseira, passam por aqui, e por isso não podem
 * discordar sobre o repouso de ninguém. A frente de calibração troca esta
 * função, não as fórmulas.
 */
export function baselineFor(
  restingInput: Parameters<typeof restingBaseline>[0],
  birthDate: Date | null,
  now: Date,
): { baseline: Baseline; resting: RestingBaseline; ageYears: number | null; maxBpm: number | null } {
  const resting = restingBaseline(restingInput)
  const ageYears = birthDate === null ? null : ageInYearsAt(birthDate, now)
  const maxBpm = ageYears === null ? null : maxHeartRateForAge(ageYears)
  const baseline: Baseline =
    maxBpm === null
      ? { kind: 'unavailable', reason: 'no_birth_date' }
      : { kind: 'available', restingBpm: resting.restingBpm, maxBpm }
  return { baseline, resting, ageYears, maxBpm }
}

/**
 * Menor distância aceita entre repouso e topo da régua. Um pico habitual mal
 * medido, quase colado no repouso, faria qualquer batimento virar esforço
 * máximo; abaixo disso a régua volta para a máxima por idade.
 */
export const MIN_RESERVE_BPM = 20

/** De onde veio o topo da régua: idade, mistura de idade com pico, ou só o pico pessoal. */
export type PeakSource = 'AGE' | 'BLEND' | 'PERSONAL'

/** O que a avaliação lê da `WorkerCalibration`. */
export interface CalibrationRuler {
  restingBpm: number | null
  peakBpm: number | null
  validDays: number
}

/**
 * A linha de base com a calibração individual (revisão 2.0): repouso dos dias
 * válidos e topo da régua no pico habitual, já misturado com a idade pelo
 * recálculo. Sem calibração (DEMO ou funcionário sem dado), a de sempre.
 */
export function calibratedBaselineFor(
  calibration: CalibrationRuler | null,
  restingInput: Parameters<typeof restingBaseline>[0],
  birthDate: Date | null,
  now: Date,
): ReturnType<typeof baselineFor> & { peakSource: PeakSource } {
  const legacy = baselineFor(restingInput, birthDate, now)
  if (calibration === null) return { ...legacy, peakSource: 'AGE' }

  const resting: RestingBaseline =
    calibration.restingBpm === null
      ? legacy.resting
      : { restingBpm: calibration.restingBpm, source: 'measured', days: calibration.validDays }

  let maxBpm = calibration.peakBpm ?? legacy.maxBpm
  // Sem idade, o pico guardado é só pessoal; com idade, a parte pessoal só
  // entra no 3º dia válido, e antes disso o guardado ainda é a partida.
  let peakSource: PeakSource =
    calibration.peakBpm === null
      ? 'AGE'
      : calibration.validDays >= FULL_DAYS || legacy.maxBpm === null
        ? 'PERSONAL'
        : calibration.validDays >= PERSONAL_FROM_DAY
          ? 'BLEND'
          : 'AGE'
  if (maxBpm !== null && maxBpm - resting.restingBpm < MIN_RESERVE_BPM) {
    maxBpm = legacy.maxBpm
    peakSource = 'AGE'
  }
  const baseline: Baseline =
    maxBpm === null
      ? { kind: 'unavailable', reason: 'no_birth_date' }
      : { kind: 'available', restingBpm: resting.restingBpm, maxBpm }
  return { baseline, resting, ageYears: legacy.ageYears, maxBpm, peakSource }
}

/**
 * A calibração que as duas avaliações leem. Só a origem REAL tem calibração:
 * DEMO passa nulo e segue a régua de sempre.
 */
export async function calibrationRulerOf(
  tx: Prisma.TransactionClient,
  workerId: string,
  origin: TelemetryOrigin,
): Promise<(CalibrationRuler & { version: string }) | null> {
  if (origin !== 'REAL') return null
  return tx.workerCalibration.findUnique({
    where: { workerId },
    select: { version: true, restingBpm: true, peakBpm: true, validDays: true },
  })
}

/** O que a linha grava sobre a calibração usada. */
export function calibrationInputsOf(
  calibration: { version: string; validDays: number } | null,
  peakSource: PeakSource,
): { calibrationVersion: string | null; phaseDay: number | null; peakSource: PeakSource } {
  return {
    calibrationVersion: calibration?.version ?? null,
    phaseDay: calibration?.validDays ?? null,
    peakSource,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Quantos Resumos provisórios podem existir ao mesmo tempo: o dia de hoje e os
 * dois anteriores, que terminaram mas ainda não fecharam. É a folga que a
 * consulta da linha de base dá além dos dias medidos; os dois anteriores já
 * contam como medidos, e o corte nos 14 dias é feito depois.
 */
const OPEN_DAY_ROWS = 3

/**
 * Mínimos diários para o repouso. Mesma consulta e mesmo corte que a avaliação
 * do relógio sempre fez; mora aqui para a esparsa usar a mesma.
 */
export async function restingMinimaOf(
  tx: Prisma.TransactionClient,
  workerId: string,
  origin: TelemetryOrigin,
  now: Date,
  restingDays: number,
): Promise<{ endedDayMinima: number[]; openDayMinima: number[] }> {
  const sinceDay = new Date(monitoredDayOf(now).getTime() - restingDays * DAY_MS)
  const summaries = await tx.telemetryDailySummary.findMany({
    // Os Resumos provisórios vêm junto, mais recentes primeiro. O de um dia
    // que já terminou conta como medido; só o do dia em andamento fica de
    // fora da mediana, e o teto deixa folga para ele sem cortar os 14 dias.
    where: { workerId, origin, day: { gte: sinceDay }, heartRateMin: { not: null } },
    select: { day: true, heartRateMin: true, provisional: true },
    orderBy: { day: 'desc' },
    take: restingDays + OPEN_DAY_ROWS,
  })

  const todayMs = monitoredDayOf(now).getTime()
  const minimaOf = (rows: typeof summaries) => rows.flatMap((s) => (s.heartRateMin === null ? [] : [s.heartRateMin]))
  // Um dia terminou quando é anterior ao dia monitorado de agora: o Resumo
  // dele, definitivo ou provisório, é medido. O do dia em andamento não é.
  const endedDayMinima = minimaOf(summaries.filter((s) => !s.provisional || s.day.getTime() < todayMs)).slice(
    0,
    restingDays,
  )
  const openDayMinima = minimaOf(summaries.filter((s) => s.provisional && s.day.getTime() >= todayMs))
  return { endedDayMinima, openDayMinima }
}
