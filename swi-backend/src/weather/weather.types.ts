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
export type WeatherAlertKind = 'CHUVA_INTENSA' | 'TEMPESTADE' | 'SOL_INTENSO'
/** ATENCAO pede cuidado; PERIGO pede interromper a atividade exposta. */
export type WeatherAlertSeverity = 'ATENCAO' | 'PERIGO'
export interface WeatherAlert {
  id: string
  kind: WeatherAlertKind
  severity: WeatherAlertSeverity
  /** Título curto do alerta, pronto para a tela. */
  event: string
  description: string
  startsAt: string
  endsAt: string
}
export interface WeatherSnapshot {
  current: WeatherCurrent
  daily: WeatherDaily
  hourly?: WeatherHourly[]
  alerts: WeatherAlert[]
  /** Instante da leitura que sustenta a resposta; na leitura velha, o da última boa. */
  fetchedAt: string
  /** A fonte falhou agora e a resposta repete a última leitura boa. */
  stale: boolean
  /**
   * A fonte falhou e não há leitura boa para repetir: current, daily e hourly
   * trazem valores de reserva, que a tela não deve apresentar como medição.
   */
  unavailable: boolean
  /** Há alerta de demonstração na resposta. Nunca verdadeiro em produção. */
  demo: boolean
}

/**
 * Uma hora da previsão com o que as regras de alerta leem. Cada campo é nulo
 * quando a fonte não o entrega: a regra correspondente simplesmente não abre.
 */
export interface HazardHour {
  /** ISO-8601 em UTC do início da hora. */
  at: string
  precipitationMm: number | null
  precipitationProbabilityPct: number | null
  /** Código WMO do tempo presente. */
  weatherCode: number | null
  uvIndex: number | null
  apparentTempC: number | null
  windGustsKmh: number | null
  isDay: boolean | null
}

export interface SiteLocation { lat: number; lng: number }

/** Local que vale para a empresa; `configured` falso quando é o padrão do serviço. */
export interface WeatherLocation extends SiteLocation { configured: boolean }

/** O que o provedor devolve para um local. */
export interface WeatherReading {
  current: WeatherCurrent
  daily: WeatherDaily
  hourly: WeatherHourly[]
  /** Ausente em provedor que não entrega previsão de risco. */
  hazards?: HazardHour[]
  /** Deslocamento do fuso do local, para escrever horários na hora de lá. */
  utcOffsetSeconds?: number
}

// Local padrão da obra (piloto SP), o mesmo centroide do SITE_LOCATION do
// mobile. Vale para a empresa que ainda não informou a própria localização.
export const SITE_LOCATION: SiteLocation = { lat: -23.55, lng: -46.63 }

/** Deslocamento de Brasília, usado quando o provedor não informa o fuso. */
export const DEFAULT_UTC_OFFSET_SECONDS = -3 * 3600

/**
 * Chave de um local com duas casas decimais (cerca de 1 km): empresas vizinhas
 * dividem a mesma leitura em vez de repetirem a chamada ao provedor.
 */
export const locationKey = (loc: SiteLocation): string => `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}`

/** Local da empresa quando ela informou os dois valores; senão, o padrão. */
export const locationOf = (company: { lat: number | null; lng: number | null } | null | undefined): SiteLocation =>
  company && company.lat !== null && company.lng !== null ? { lat: company.lat, lng: company.lng } : SITE_LOCATION

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
