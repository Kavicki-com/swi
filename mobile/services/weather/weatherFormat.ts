// Lógica PURA do clima (formatters + seleção de alerta vigente). Sem efeitos;
// `now` é injetado pra testabilidade. Espelha o estilo de progress.ts.
import type { WeatherSnapshot, WeatherAlert, WeatherCondition } from './types';

export function formatTempC(c: number): string { return `${Math.round(c)}ºC`; }
export function formatHumidity(pct: number): string { return `${Math.round(pct)}%`; }
export function formatWind(kmh: number): string { return `${Math.round(kmh)}km/h`; }

const CONDITION_LABEL: Record<WeatherCondition, string> = {
  clear: 'Céu limpo',
  clouds: 'Nublado',
  rain: 'Chuva Intensa',
  storm: 'Tempestade',
  snow: 'Neve',
  fog: 'Névoa',
};
export function conditionLabel(c: WeatherCondition): string { return CONDITION_LABEL[c]; }

// O 1º alerta ainda vigente (endsAt >= now), ou null. `now` default = relógio real.
export function activeAlert(s: WeatherSnapshot, now: Date = new Date()): WeatherAlert | null {
  const t = now.getTime();
  return s.alerts.find((a) => new Date(a.endsAt).getTime() >= t) ?? null;
}
