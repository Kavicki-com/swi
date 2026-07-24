// Clima do dashboard (GET /weather) contra o backend Nest. Mantém o envelope
// MockResponse pra que a tela não mude de contrato. O backend devolve um
// snapshot rico (current/daily/hourly/alerts); a tira do dashboard (Figma frame
// 4:2 weather-section) só precisa de 4 slots ao redor de "agora", então o mapper
// puro `toWeatherStrip` colapsa o snapshot no shape que a UI já consome.
import type { MockResponse } from '@/services/mockApi/types'
import { apiFetch } from './http'
// Slot da tira do dashboard — o tipo canônico vive em ./dashboard (um só símbolo).
import type { WeatherSlot } from './dashboard'

// Espelha o WeatherSnapshot do backend (swi-backend/src/weather/weather.types.ts).
export type WeatherConditionDto = 'clear' | 'clouds' | 'rain' | 'storm' | 'snow' | 'fog'
export type WeatherHourlyDto = {
  at: string
  tempC: number
  condition: WeatherConditionDto
  isDay?: boolean // is_day do Open-Meteo (aditivo; ausente em payload antigo)
}
export type WeatherSnapshotDto = {
  current: { tempC: number; condition: WeatherConditionDto; humidityPct: number; windKmh: number }
  daily: { minC: number; maxC: number }
  hourly?: WeatherHourlyDto[]
  alerts: unknown[]
  fetchedAt: string
}

type StripCondition = WeatherSlot['condition']

// Condição rica do backend → buckets visuais da tira (Figma). sol vira "sun",
// nuvem/névoa viram "cloudy" (parcialmente nublado), neve/chuva viram "rain",
// tempestade fica distinta.
const CONDITION_TO_STRIP: Record<WeatherConditionDto, StripCondition> = {
  clear: 'sun',
  clouds: 'cloudy',
  fog: 'cloudy',
  rain: 'rain',
  snow: 'rain',
  storm: 'storm',
}

// Labels PT-BR coerentes por bucket de condição (derivadas da condição real, não
// decoração por slot do Figma). Estilo de duas linhas (\n) que a WeatherTimeline
// espera; storm reflete tempestade, não "parcialmente nublado".
const STRIP_LABEL: Record<StripCondition, string> = {
  sun: 'SOL\nINTENSO',
  cloudy: 'PARCIALMENTE\nNUBLADO',
  rain: 'CHUVAS\nMODERADAS',
  storm: 'TEMPESTADE',
}

// Offsets em horas relativos a fetchedAt: passado (-4h), agora (0), futuro (+2h, +4h).
// O slot de offset 0 recebe isNow (marcador AGORA da WeatherTimeline).
const SLOT_OFFSETS_H = [-4, 0, 2, 4] as const

/**
 * Colapsa o snapshot do backend na tira de 4 slots que a UI consome. Puro e
 * testável: pra cada offset acha a hora de `hourly` mais próxima do alvo
 * (fetchedAt + offset). Sem `hourly` (ou vazio) devolve [] — degradação
 * graciosa, a UI só some com a seção.
 */
export function toWeatherStrip(snap: WeatherSnapshotDto): WeatherSlot[] {
  const hourly = snap.hourly
  if (!hourly || hourly.length === 0) return []
  const base = Date.parse(snap.fetchedAt)
  // fetchedAt inválido → todo offset vira NaN e o reduce degenera; melhor
  // sumir com a seção (mesma degradação de hourly ausente) do que exibir lixo.
  if (Number.isNaN(base)) return []

  const slots = SLOT_OFFSETS_H.map((offsetH) => {
    const targetMs = base + offsetH * 3_600_000
    const nearest = hourly.reduce((best, h) =>
      Math.abs(Date.parse(h.at) - targetMs) < Math.abs(Date.parse(best.at) - targetMs) ? h : best,
    )
    const condition = CONDITION_TO_STRIP[nearest.condition]
    const slot: WeatherSlot = {
      at: nearest.at,
      condition,
      tempC: nearest.tempC,
      label: STRIP_LABEL[condition],
    }
    if (offsetH === 0) slot.isNow = true
    // Noite só quando o backend AFIRMA isDay=false; sem is_day não inventa.
    if (nearest.isDay === false) slot.isNight = true
    return slot
  })

  // Série esparsa faz offsets distintos resolverem pra mesma hora — dedup por
  // `at`, preservando o isNow de qualquer duplicata colapsada.
  const byAt = new Map<string, WeatherSlot>()
  for (const slot of slots) {
    const seen = byAt.get(slot.at)
    if (!seen) byAt.set(slot.at, slot)
    else if (slot.isNow) seen.isNow = true
  }
  return [...byAt.values()]
}

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export const weatherApi = {
  async get(): Promise<MockResponse<WeatherSlot[]>> {
    try {
      const snap = await apiFetch<WeatherSnapshotDto>('/weather')
      return { data: toWeatherStrip(snap), error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao carregar clima') } }
    }
  },
}
