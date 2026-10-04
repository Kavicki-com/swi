import { apiRequest } from '../api/http';
import type { TelemetryOrigin } from './myTelemetry';

// Série por período do próprio funcionário (GET /telemetry/v1/me/series).
// Os tipos espelham o contrato do backend. "Hoje" vem em baldes de hora, da
// meia-noite de Brasília até a hora corrente; semana e mês vêm em baldes de
// dia, montados a partir do resumo diário. Balde sem medição traz null, nunca
// zero, e quem nunca reportou recebe a série com origin null, não erro.

export type SeriesPeriod = 'day' | 'week' | 'month';

export interface SeriesPoint {
  /** ISO-8601 do início do balde. */
  start: string;
  /** ISO-8601 do fim do balde, exclusivo. */
  end: string;
  activeEnergyKcal: number | null;
  steps: number | null;
  distanceM: number | null;
  heartRate: { avg: number | null; min: number | null; max: number | null };
  /** Fração do balde coberta por leituras, de 0 a 1. */
  coverage: number;
}

export interface WorkerSeries {
  workerId: string;
  period: SeriesPeriod;
  /** null enquanto o funcionário nunca reportou. Nunca mistura as duas. */
  origin: TelemetryOrigin | null;
  bucket: 'hour' | 'day';
  /** ISO-8601 do início do primeiro balde. */
  from: string;
  /** ISO-8601 do instante da leitura. */
  to: string;
  points: SeriesPoint[];
}

export const mySeriesPath = (period: SeriesPeriod) => `/telemetry/v1/me/series?period=${period}`;

/**
 * Lança em falha de rede ou de sessão, e também quando a resposta não é uma
 * série: o cliente HTTP devolve {} para corpo que não é JSON. Quem chama
 * decide o que a tela diz.
 */
export async function fetchMySeries(period: SeriesPeriod): Promise<WorkerSeries> {
  const data: unknown = await apiRequest(mySeriesPath(period), { auth: true });
  const body = data as Partial<WorkerSeries> | null;
  if (!body || !Array.isArray(body.points) || (body.bucket !== 'hour' && body.bucket !== 'day')) {
    throw new Error('Série de telemetria fora do contrato');
  }
  return body as WorkerSeries;
}
