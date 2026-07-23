// Clima do dashboard (GET /weather) contra o backend Nest. Mantém o envelope
// MockResponse pra que a tela não mude de contrato. O backend devolve um
// snapshot rico (current/daily/hourly/alerts); a tira do dashboard (Figma frame
// 4:2 weather-section) só precisa de 4 slots ao redor de "agora", então o mapper
// puro `toWeatherStrip` colapsa o snapshot no shape que a UI já consome.
import type { MockResponse } from '@/services/mockApi/types'
import { apiFetch } from './http'
import type { DashboardSummary } from './dashboard'

// Espelha o WeatherSnapshot do backend (swi-backend/src/weather/weather.types.ts).
export type WeatherConditionDto = 'clear' | 'clouds' | 'rain' | 'storm' | 'snow' | 'fog'
export type WeatherHourlyDto = { at: string; tempC: number; condition: WeatherConditionDto }
export type WeatherSnapshotDto = {
  current: { tempC: number; condition: WeatherConditionDto; humidityPct: number; windKmh: number }
  daily: { minC: number; maxC: number }
  hourly?: WeatherHourlyDto[]
  alerts: unknown[]
  fetchedAt: string
}

// Slot da tira do dashboard — apelido do subtipo canônico em ./dashboard.
export type WeatherSlot = DashboardSummary['weather'][number]
type StripCondition = WeatherSlot['condition']

// Condição rica do backend → 3 buckets visuais da tira (Figma). storm é o único
// distinto; nuvem/névoa/sol viram "sun", neve/chuva viram "rain".
const CONDITION_TO_STRIP: Record<WeatherConditionDto, StripCondition> = {
  clear: 'sun',
  clouds: 'sun',
  fog: 'sun',
  rain: 'rain',
  snow: 'rain',
  storm: 'storm',
}

// Labels PT-BR por bucket — texto copiado do mock antigo (mockApi/dashboard.ts)
// pra manter a paridade com o Figma (quebra de linha via \n).
const STRIP_LABEL: Record<StripCondition, string> = {
  sun: 'SOL\nINTENSO',
  rain: 'CHUVAS\nMODERADAS',
  storm: 'PARCIALMENTE\nNUBLADO',
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

  return SLOT_OFFSETS_H.map((offsetH) => {
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
    return slot
  })
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
