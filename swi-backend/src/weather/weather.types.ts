// Espelha o shape do seam mobile services/weather/types.ts (siblings isolados).
export type WeatherCondition = 'clear' | 'clouds' | 'rain' | 'storm' | 'snow' | 'fog'
export interface WeatherCurrent { tempC: number; condition: WeatherCondition; humidityPct: number; windKmh: number }
export interface WeatherDaily { minC: number; maxC: number }
export interface WeatherHourly {
  at: string // ISO datetime da hora cheia
  tempC: number
  condition: WeatherCondition
  isDay?: boolean // is_day do Open-Meteo (aditivo; ausente em payload antigo)
}
export interface WeatherAlert { id: string; event: string; description: string; startsAt: string; endsAt: string }
export interface WeatherSnapshot { current: WeatherCurrent; daily: WeatherDaily; hourly?: WeatherHourly[]; alerts: WeatherAlert[]; fetchedAt: string }

// Local fixo da obra (piloto SP) — mesmo centroide do SITE_LOCATION do mobile.
export const SITE_LOCATION = { lat: -23.55, lng: -46.63 }

// Números canned de fallback (paridade EXATA com o mockWeatherBackend do mobile).
export const CANNED_CURRENT: WeatherCurrent = { tempC: 17, condition: 'rain', humidityPct: 65, windKmh: 65 }
export const CANNED_DAILY: WeatherDaily = { minC: 19, maxC: 32 }

// Fallback canned da série horária. offsetH é resolvido em runtime pelo service.
export const CANNED_HOURLY: ReadonlyArray<{ offsetH: number; tempC: number; condition: WeatherCondition }> = [
  { offsetH: -4, tempC: 16, condition: 'rain' },
  { offsetH: -3, tempC: 16, condition: 'rain' },
  { offsetH: -2, tempC: 17, condition: 'clouds' },
  { offsetH: -1, tempC: 17, condition: 'clouds' },
  { offsetH: 0, tempC: 17, condition: 'rain' },
  { offsetH: 2, tempC: 18, condition: 'clouds' },
  { offsetH: 4, tempC: 18, condition: 'clear' },
]

// id estável do alerta de demo — dedup do cron + pré-seed dependem dele.
export const DEMO_STORM_ALERT_ID = 'wx-0'
