// Séries de telemetria para teste, no formato de GET /telemetry/v1/me/series.
import type { SeriesPeriod, SeriesPoint, WorkerSeries } from './mySeries';

const HOUR = 60 * 60 * 1000;

/** Meia-noite de Brasília do dia de teste, o primeiro balde de "hoje". */
export const SERIES_DAY_START = '2026-10-01T03:00:00.000Z';

/**
 * Baldes consecutivos a partir de `from`, um por valor de kcal. null é balde
 * sem medição: a cobertura vai a zero e as outras métricas também ficam nulas.
 */
export const seriesPoints = (
  kcal: readonly (number | null)[],
  stepMs: number,
  from = SERIES_DAY_START,
): SeriesPoint[] =>
  kcal.map((value, i) => {
    const start = Date.parse(from) + i * stepMs;
    return {
      start: new Date(start).toISOString(),
      end: new Date(start + stepMs).toISOString(),
      activeEnergyKcal: value,
      steps: value === null ? null : 500,
      distanceM: value === null ? null : 350,
      heartRate:
        value === null ? { avg: null, min: null, max: null } : { avg: 96, min: 71, max: 128 },
      coverage: value === null ? 0 : 1,
    };
  });

/**
 * Série do período com um balde por valor de kcal (hora em "day", dia nos
 * outros). Sem `to`, a leitura acontece no fim do último balde, com todos
 * completos; um `to` anterior deixa o último balde em curso.
 */
export const series = (
  period: SeriesPeriod,
  kcal: readonly (number | null)[],
  origin: WorkerSeries['origin'] = 'REAL',
  to?: string,
): WorkerSeries => {
  const stepMs = period === 'day' ? HOUR : 24 * HOUR;
  const points = seriesPoints(kcal, stepMs);
  return {
    workerId: 'w1',
    period,
    origin,
    bucket: period === 'day' ? 'hour' : 'day',
    from: points[0]?.start ?? SERIES_DAY_START,
    to: to ?? points[points.length - 1]?.end ?? SERIES_DAY_START,
    points,
  };
};

/** O que o backend devolve para quem nunca reportou: baldes vazios, origem nula. */
export const emptySeries = (period: SeriesPeriod, buckets: number): WorkerSeries =>
  series(period, Array.from({ length: buckets }, () => null), null);
