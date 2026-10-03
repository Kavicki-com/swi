import { WEATHER_ALERT_PROFILE as P } from './weather-alert-profile'
import type { HazardHour, WeatherAlert, WeatherAlertKind, WeatherAlertSeverity } from './weather.types'

// Avaliação pura dos alertas meteorológicos: mesma previsão e mesmo instante
// dão sempre os mesmos alertas. Não lê relógio, ambiente nem banco.

const HOUR_MS = 3_600_000

/** O que uma hora diz sobre um tipo de alerta, ou nulo quando não o abre. */
interface HourVerdict {
  severity: WeatherAlertSeverity
  /** Valor que entra no texto (mm por hora, índice UV), quando houver. */
  peak: number | null
}

const worst = (a: WeatherAlertSeverity, b: WeatherAlertSeverity): WeatherAlertSeverity =>
  a === 'PERIGO' || b === 'PERIGO' ? 'PERIGO' : 'ATENCAO'

function heavyRain(h: HazardHour): HourVerdict | null {
  if (h.precipitationMm === null || h.precipitationMm < P.rainAttentionMmPerHour) return null
  // Probabilidade ausente não bloqueia: o volume previsto já é o sinal.
  if (h.precipitationProbabilityPct !== null && h.precipitationProbabilityPct < P.rainMinProbabilityPct) return null
  return {
    severity: h.precipitationMm >= P.rainDangerMmPerHour ? 'PERIGO' : 'ATENCAO',
    peak: h.precipitationMm,
  }
}

function thunderstorm(h: HazardHour): HourVerdict | null {
  if (h.weatherCode === null) return null
  const code = h.weatherCode
  if (!(P.thunderstormCodes as readonly number[]).includes(code)) return null
  const hail = (P.thunderstormHailCodes as readonly number[]).includes(code)
  const gale = h.windGustsKmh !== null && h.windGustsKmh >= P.gustDangerKmh
  return { severity: hail || gale ? 'PERIGO' : 'ATENCAO', peak: null }
}

function intenseSun(h: HazardHour): HourVerdict | null {
  // Só com sol: de noite não há exposição solar a alertar. Sem a informação de
  // dia ou noite a regra não abre, em vez de supor.
  if (h.isDay !== true) return null
  const uv = h.uvIndex !== null && h.uvIndex >= P.uvAttention
  const heat = h.apparentTempC !== null && h.apparentTempC >= P.apparentTempAttentionC
  if (!uv && !heat) return null
  const danger =
    (h.uvIndex !== null && h.uvIndex >= P.uvDanger) ||
    (h.apparentTempC !== null && h.apparentTempC >= P.apparentTempDangerC)
  return { severity: danger ? 'PERIGO' : 'ATENCAO', peak: h.uvIndex }
}

/** Hora local "HH:MM" de um instante, pelo deslocamento do fuso do local. */
function localClock(instantMs: number, utcOffsetSeconds: number): string {
  const local = new Date(instantMs + utcOffsetSeconds * 1000)
  const hh = String(local.getUTCHours()).padStart(2, '0')
  const mm = String(local.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

interface KindRule {
  kind: WeatherAlertKind
  event: string
  verdict: (h: HazardHour) => HourVerdict | null
  describe: (from: string, to: string, peak: number | null, severity: WeatherAlertSeverity) => string
}

// A ordem aqui é a ordem dos alertas na resposta.
const RULES: readonly KindRule[] = [
  {
    kind: 'CHUVA_INTENSA',
    event: 'Chuva intensa',
    verdict: heavyRain,
    describe: (from, to, peak) =>
      `Chuva forte prevista entre ${from} e ${to}` + (peak === null ? '.' : `, com até ${Math.round(peak)} mm por hora.`),
  },
  {
    kind: 'TEMPESTADE',
    event: 'Tempestade',
    verdict: thunderstorm,
    describe: (from, to, _peak, severity) =>
      severity === 'PERIGO'
        ? `Tempestade com granizo ou rajadas fortes prevista entre ${from} e ${to}. Interrompa o trabalho exposto.`
        : `Tempestade com raios prevista entre ${from} e ${to}. Evite áreas abertas e estruturas altas.`,
  },
  {
    kind: 'SOL_INTENSO',
    event: 'Sol intenso',
    verdict: intenseSun,
    describe: (from, to, peak) =>
      `Sol e calor intensos previstos entre ${from} e ${to}` +
      (peak === null ? '.' : `, com índice UV até ${Math.round(peak)}.`) +
      ' Reforce hidratação, sombra e pausas.',
  },
]

/**
 * Alertas vigentes ou iminentes para um local. Olha da hora em curso até o
 * horizonte do perfil e devolve, por tipo, a primeira janela contínua de horas
 * em que a regra abre.
 */
export function evaluateWeatherAlerts(hours: readonly HazardHour[], now: Date, utcOffsetSeconds: number): WeatherAlert[] {
  const nowMs = now.getTime()
  const horizonEnd = nowMs + P.horizonHours * HOUR_MS
  const inWindow = hours
    .map((h) => ({ h, start: Date.parse(h.at) }))
    // A hora em curso conta (termina depois de agora); a já encerrada, não.
    .filter(({ start }) => Number.isFinite(start) && start + HOUR_MS > nowMs && start < horizonEnd)
    .sort((a, b) => a.start - b.start)

  const alerts: WeatherAlert[] = []
  for (const rule of RULES) {
    let first: number | null = null
    let last = 0
    let severity: WeatherAlertSeverity = 'ATENCAO'
    let peak: number | null = null
    for (const { h, start } of inWindow) {
      const v = rule.verdict(h)
      // A primeira janela contínua termina na hora que não abre a regra ou num
      // salto de horas. As janelas seguintes ficam para a próxima avaliação.
      if (first !== null && (v === null || start !== last + HOUR_MS)) break
      if (v === null) continue
      severity = first === null ? v.severity : worst(severity, v.severity)
      if (first === null) first = start
      last = start
      if (v.peak !== null) peak = peak === null ? v.peak : Math.max(peak, v.peak)
    }
    if (first === null) continue
    const startsAt = new Date(first).toISOString()
    const end = last + HOUR_MS
    alerts.push({
      id: `wx:${rule.kind}:${startsAt}`,
      kind: rule.kind,
      severity,
      event: rule.event,
      description: rule.describe(localClock(first, utcOffsetSeconds), localClock(end, utcOffsetSeconds), peak, severity),
      startsAt,
      endsAt: new Date(end).toISOString(),
    })
  }
  return alerts
}
