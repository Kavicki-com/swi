import { Injectable } from '@nestjs/common'
import { httpGetJson } from '../common/httpGet'
import type { WeatherCondition, WeatherCurrent, WeatherDaily, WeatherHourly } from './weather.types'
import { SITE_LOCATION } from './weather.types'

// Códigos WMO (Open-Meteo): 0 limpo · 1-3 nuvens · 45/48 névoa · 51-67 e 80-82
// chuva · 71-77 e 85-86 neve · 95-99 tempestade. Desconhecido → 'clouds' (neutro).
export function mapWeatherCode(code: number): WeatherCondition {
  if (code === 0) return 'clear'
  if (code <= 3) return 'clouds'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 95) return 'storm'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  return 'clouds'
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) throw new Error('open-meteo: número ausente/inválido')
  return n
}

// Recorte do payload do Open-Meteo que esta coerção lê. Os valores são
// `unknown` de propósito: o contrato é de terceiro e pode chegar incompleto ou
// com o tipo errado, e quem valida cada número em runtime é `num()`. Declará-los
// como `number` seria uma promessa que a API não faz.
type OpenMeteoRaw = {
  current?: {
    temperature_2m?: unknown
    weather_code?: unknown
    relative_humidity_2m?: unknown
    wind_speed_10m?: unknown
  }
  daily?: {
    temperature_2m_max?: unknown[]
    temperature_2m_min?: unknown[]
  }
  hourly?: {
    time?: string[]
    temperature_2m?: unknown[]
    weather_code?: unknown[]
    is_day?: unknown[]
  }
}

// Coerção PURA payload Open-Meteo → nosso shape. Lança em payload incompleto
// (o WeatherService trata com fallback canned).
export function coerceOpenMeteo(payload: unknown): {
  current: WeatherCurrent
  daily: WeatherDaily
  hourly: WeatherHourly[]
} {
  // A assinatura pública é `unknown` porque é isso que chega de `res.json()`.
  // A asserção fica num ponto só, e não promete nada além do recorte acima:
  // todo campo é opcional e cada número ainda passa por `num()`.
  const raw = payload as OpenMeteoRaw | null | undefined
  const c = raw?.current, d = raw?.daily
  if (!c || !d) throw new Error('open-meteo: payload sem current/daily')
  const current: WeatherCurrent = {
    tempC: Math.round(num(c.temperature_2m)),
    condition: mapWeatherCode(num(c.weather_code)),
    humidityPct: Math.round(num(c.relative_humidity_2m)),
    windKmh: Math.round(num(c.wind_speed_10m)),
  }
  const daily: WeatherDaily = { maxC: Math.round(num(d.temperature_2m_max?.[0])), minC: Math.round(num(d.temperature_2m_min?.[0])) }
  // Os arrays saem para constantes antes do teste de existência: o estreitamento
  // de uma propriedade não sobrevive dentro do callback do map, o de uma const sim.
  const h = raw?.hourly
  const horas = h?.time, temps = h?.temperature_2m, codes = h?.weather_code, isDay = h?.is_day
  const hourly: WeatherHourly[] =
    horas && temps && codes
      ? horas.map((at: string, i: number) => ({
          at,
          tempC: Math.round(num(temps[i])),
          condition: mapWeatherCode(num(codes[i])),
          // is_day (0|1) é aditivo — payload sem o array segue válido, isDay omitido.
          ...(Array.isArray(isDay) ? { isDay: num(isDay[i]) === 1 } : {}),
        }))
      : []
  return { current, daily, hourly }
}

@Injectable()
export class OpenMeteoProvider {
  // Sem chave. Unidades default do Open-Meteo já batem: °C, %, km/h.
  async fetch(loc = SITE_LOCATION): Promise<{ current: WeatherCurrent; daily: WeatherDaily; hourly: WeatherHourly[] }> {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&hourly=temperature_2m,weather_code,is_day&past_days=1` +
      `&timezone=auto&forecast_days=1`
    // httpGetJson, nao fetch: o undici/Wasm derrubava o processo no host de 1 GB.
    const res = await httpGetJson(url, 5000)
    if (!res.ok) throw new Error(`open-meteo: HTTP ${res.status}`)
    return coerceOpenMeteo(await res.json())
  }
}
