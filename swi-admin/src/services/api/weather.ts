// Clima do dashboard (GET /weather) contra o backend Nest. Mantém o envelope
// ServiceResponse pra que a tela não mude de contrato. O backend devolve um
// snapshot rico (current/daily/hourly/alerts); a tira do dashboard (a
// weather-section do frame de referência) só precisa de 4 slots ao redor de "agora", então o mapper
// puro `toWeatherStrip` colapsa o snapshot no shape que a UI já consome.
import type { ServiceResponse } from '@/services/types'
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
  alerts: WeatherAlertDto[]
  fetchedAt: string
  // Aditivos do backend; ausentes em payload antigo.
  stale?: boolean
  unavailable?: boolean
  // Há alerta de demonstração na resposta. Nunca verdadeiro em produção.
  demo?: boolean
}

export type WeatherAlertKindDto = 'CHUVA_INTENSA' | 'TEMPESTADE' | 'SOL_INTENSO'
// ATENCAO pede cuidado; PERIGO pede interromper a atividade exposta.
export type WeatherAlertSeverityDto = 'ATENCAO' | 'PERIGO'
export type WeatherAlertDto = {
  id: string
  // kind e severity opcionais por tolerância a payload antigo.
  kind?: WeatherAlertKindDto
  severity?: WeatherAlertSeverityDto
  event: string // título curto, pronto para a tela
  description: string // frase pronta, já com o horário
  startsAt: string
  endsAt: string
}

// O que a tela de alertas lê do snapshot.
export type WeatherAlertsView = { alerts: WeatherAlertDto[]; demo: boolean }

const isAlert = (value: unknown): value is WeatherAlertDto => {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Record<string, unknown>
  return (
    typeof a.id === 'string' &&
    typeof a.event === 'string' &&
    typeof a.description === 'string' &&
    typeof a.startsAt === 'string' &&
    typeof a.endsAt === 'string'
  )
}

const severityRank = (a: WeatherAlertDto): number => (a.severity === 'PERIGO' ? 0 : 1)

// Início ilegível vai para o fim da fila em vez de embaralhar a ordenação.
const startMs = (a: WeatherAlertDto): number => {
  const ms = Date.parse(a.startsAt)
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

/**
 * Escolhe o alerta que a tela mostra: o vigente (ainda não expirado em
 * `nowMs`), com PERIGO na frente e, no mesmo nível, o que começa antes. Alerta
 * que ainda vai começar entra, porque a frase do backend já traz o horário.
 * Puro e tolerante: entrada malformada ou fim ilegível é descartada.
 */
export function pickActiveAlert(alerts: unknown, nowMs: number): WeatherAlertDto | null {
  if (!Array.isArray(alerts)) return null
  const current = alerts.filter(isAlert).filter((a) => Date.parse(a.endsAt) > nowMs)
  if (current.length === 0) return null
  return current.reduce((best, a) => {
    const bySeverity = severityRank(a) - severityRank(best)
    if (bySeverity !== 0) return bySeverity < 0 ? a : best
    return startMs(a) < startMs(best) ? a : best
  })
}

type StripCondition = WeatherSlot['condition']

// Condição rica do backend → buckets visuais da tira. sol vira "sun",
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
// decoração por slot do desenho). Estilo de duas linhas (\n) que a WeatherTimeline
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
  async get(): Promise<ServiceResponse<WeatherSlot[]>> {
    try {
      const snap = await apiFetch<WeatherSnapshotDto>('/weather')
      return { data: toWeatherStrip(snap), error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao carregar clima') } }
    }
  },

  // Alertas meteorológicos do local da empresa, do mesmo GET /weather. Devolve
  // a lista crua (só o que tem formato de alerta): quem escolhe o vigente é
  // `pickActiveAlert`, com o relógio de quem chama.
  async alerts(): Promise<ServiceResponse<WeatherAlertsView>> {
    try {
      const snap = await apiFetch<Partial<WeatherSnapshotDto>>('/weather')
      const alerts = Array.isArray(snap.alerts) ? snap.alerts.filter(isAlert) : []
      return { data: { alerts, demo: snap.demo === true }, error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao carregar alertas') } }
    }
  },
}
