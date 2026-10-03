// Lógica PURA do clima (formatters + seleção de alerta vigente). Sem efeitos;
// `now` é injetado pra testabilidade. Espelha o estilo de progress.ts.
import type { WeatherSnapshot, WeatherAlert, WeatherAlertSeverity, WeatherCondition } from './types';

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

// O alerta que a tela mostra: entre os ainda vigentes (endsAt >= now), o de
// perigo passa na frente; empate fica na ordem recebida. Null se não há nenhum.
// `now` default = relógio real.
export function activeAlert(s: WeatherSnapshot, now: Date = new Date()): WeatherAlert | null {
  const t = now.getTime();
  const vigentes = s.alerts.filter((a) => new Date(a.endsAt).getTime() >= t);
  return vigentes.find((a) => a.severity === 'PERIGO') ?? vigentes[0] ?? null;
}

const SEVERITY_LABEL: Record<WeatherAlertSeverity, string> = {
  ATENCAO: 'atenção',
  PERIGO: 'perigo',
};
// Linha de nível da janela "Local em Alerta!": "Tempestade: perigo",
// "Sol intenso: atenção". Sem severity (backend antigo, mock), só o evento.
export function alertLevelLabel(a: WeatherAlert): string {
  return a.severity ? `${a.event}: ${SEVERITY_LABEL[a.severity]}` : a.event;
}

// Strings de exibição do clima pras telas (dashboard alert-active + os 2 modais),
// num lugar só pra que as 3 superfícies não divirjam. Nada aqui é inventado:
// sem leitura (snapshot ausente, ou `unavailable`, quando o backend manda
// valores de reserva) as medições viram '--'; sem alerta não há descrição nem
// nível, e a tela não desenha esses textos.
export interface WeatherDisplay {
  tempStr: string; condStr: string; humStr: string; windStr: string;
  maxStr: string; minStr: string;
  descStr: string | null;
  levelStr: string | null;
}
const NO_READING = '--';
export function weatherDisplay(
  s: WeatherSnapshot | null,
  alert: WeatherAlert | null,
): WeatherDisplay {
  const medido = s && !s.unavailable ? s : null;
  const cur = medido?.current;
  const day = medido?.daily;
  return {
    tempStr: cur ? formatTempC(cur.tempC) : NO_READING,
    condStr: cur ? conditionLabel(cur.condition) : NO_READING,
    humStr: cur ? formatHumidity(cur.humidityPct) : NO_READING,
    windStr: cur ? formatWind(cur.windKmh) : NO_READING,
    maxStr: day ? formatTempC(day.maxC) : NO_READING,
    minStr: day ? formatTempC(day.minC) : NO_READING,
    descStr: alert?.description || null,
    levelStr: alert ? alertLevelLabel(alert) : null,
  };
}
