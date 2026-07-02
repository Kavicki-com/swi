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

// Strings de exibição do clima pras telas (dashboard alert-active + os 2 modais),
// com fallback pro texto estático de hoje quando não há snapshot/alerta — assim
// a tela de segurança nunca quebra E as 3 superfícies não divergem na cópia.
export interface WeatherDisplay {
  tempStr: string; condStr: string; humStr: string; windStr: string;
  maxStr: string; minStr: string; descStr: string;
}
const FALLBACK_ALERT_DESC =
  'Risco de desabamentos nas primeiras horas do dia, procure a rota de siga as instruções para a evacuação.';
export function weatherDisplay(
  s: WeatherSnapshot | null,
  alert: WeatherAlert | null,
): WeatherDisplay {
  const cur = s?.current;
  const day = s?.daily;
  return {
    tempStr: cur ? formatTempC(cur.tempC) : '17ºC',
    condStr: cur ? conditionLabel(cur.condition) : 'Chuva Intensa',
    humStr: cur ? formatHumidity(cur.humidityPct) : '65%',
    windStr: cur ? formatWind(cur.windKmh) : '65km/h',
    maxStr: day ? formatTempC(day.maxC) : '32ºC',
    minStr: day ? formatTempC(day.minC) : '19ºC',
    descStr: alert?.description ?? FALLBACK_ALERT_DESC,
  };
}
