import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { OpenMeteoProvider } from './weather.provider'
import { evaluateWeatherAlerts } from './weather-alert-rules'
import {
  CANNED_CURRENT,
  CANNED_DAILY,
  CANNED_HOURLY,
  DEFAULT_UTC_OFFSET_SECONDS,
  DEMO_STORM_ALERT_ID,
  SITE_LOCATION,
  locationKey,
  locationOf,
} from './weather.types'
import type {
  SiteLocation,
  WeatherAlert,
  WeatherHourly,
  WeatherLocation,
  WeatherReading,
  WeatherSnapshot,
} from './weather.types'

const STORM_DESC =
  'Risco de desabamentos nas primeiras horas do dia, procure a rota de siga as instruções para a evacuação.'

// Alerta canned de demo (paridade com o mockWeatherBackend). Id 'wx-0' estável
// pro dedup do cron; startsAt/endsAt na hora → alerta SEMPRE vigente.
function stormAlert(now: Date): WeatherAlert {
  return {
    id: DEMO_STORM_ALERT_ID,
    kind: 'TEMPESTADE',
    severity: 'PERIGO',
    event: 'Tempestade severa',
    description: STORM_DESC,
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  }
}

const MINUTE_MS = 60_000

// Leitura recente do mesmo local é reaproveitada: a tela de cada funcionário e
// a rodada dos alertas não viram, cada uma, uma chamada ao provedor.
const FRESH_MS = 10 * MINUTE_MS

// Com a fonte fora do ar, a última leitura boa ainda serve por este prazo,
// marcada como velha. A previsão de risco cobre dois dias, então as horas à
// frente continuam valendo; passado o prazo, a resposta fica indisponível.
const STALE_MAX_MS = 6 * 60 * MINUTE_MS

interface CachedReading { reading: WeatherReading; at: number }

/** O que sustenta uma resposta: a leitura e se ela é a última boa repetida. */
interface ReadingState { reading: WeatherReading; at: number; stale: boolean }

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name)
  private readonly lastGood = new Map<string, CachedReading>()

  constructor(
    private readonly provider: OpenMeteoProvider,
    private readonly prisma: PrismaService,
  ) {}

  /** Clima do local da empresa do requisitante; sem empresa, o local padrão. */
  async getSnapshot(companyId?: string | null): Promise<WeatherSnapshot> {
    return this.snapshotAt(await this.locationFor(companyId))
  }

  async snapshotAt(loc: SiteLocation, now = new Date()): Promise<WeatherSnapshot> {
    const state = await this.read(loc, now)
    const demo = this.demoAlerts(now)
    const alerts = [...this.realAlerts(state, now), ...demo]
    if (!state) {
      // Tela de segurança nunca quebra: sem leitura nenhuma, valores de reserva
      // marcados como indisponíveis, para não passarem por medição.
      return {
        current: CANNED_CURRENT,
        daily: CANNED_DAILY,
        hourly: this.cannedHourly(now),
        alerts,
        fetchedAt: now.toISOString(),
        stale: false,
        unavailable: true,
        demo: demo.length > 0,
      }
    }
    const { reading } = state
    return {
      current: reading.current,
      daily: reading.daily,
      hourly: reading.hourly?.length ? reading.hourly : this.cannedHourly(now),
      alerts,
      fetchedAt: new Date(state.at).toISOString(),
      stale: state.stale,
      unavailable: false,
      demo: demo.length > 0,
    }
  }

  /** Só os alertas nascidos da previsão real do local, sem o de demonstração. */
  async alertsAt(loc: SiteLocation, now = new Date()): Promise<WeatherAlert[]> {
    return this.realAlerts(await this.read(loc, now), now)
  }

  // Alerta: dev via WEATHER_SCENARIO='alert'. NUNCA fabrica alerta sem a flag.
  demoAlerts(now: Date): WeatherAlert[] {
    // O ambiente vem antes da flag: em produção, alerta só pode nascer de fonte
    // real. Um alerta fabricado aqui mandaria gente evacuar sem tempestade.
    if (process.env.NODE_ENV === 'production') return []
    return process.env.WEATHER_SCENARIO === 'alert' ? [stormAlert(now)] : []
  }

  async getLocation(companyId: string | null): Promise<WeatherLocation> {
    const id = this.requireCompany(companyId)
    const row = await this.prisma.company.findUnique({ where: { id }, select: { lat: true, lng: true } })
    if (!row) throw new NotFoundException('Empresa não encontrada')
    return this.toLocation(row)
  }

  async setLocation(companyId: string | null, loc: SiteLocation): Promise<WeatherLocation> {
    return this.writeLocation(companyId, { lat: loc.lat, lng: loc.lng })
  }

  /** Volta a empresa para o local padrão do serviço. */
  async resetLocation(companyId: string | null): Promise<WeatherLocation> {
    return this.writeLocation(companyId, { lat: null, lng: null })
  }

  private async writeLocation(
    companyId: string | null,
    data: { lat: number | null; lng: number | null },
  ): Promise<WeatherLocation> {
    const id = this.requireCompany(companyId)
    const row = await this.prisma.company.update({ where: { id }, data, select: { lat: true, lng: true } })
    return this.toLocation(row)
  }

  // O local é da empresa: administrador sem empresa não tem o que configurar.
  private requireCompany(companyId: string | null): string {
    if (!companyId) throw new ForbiddenException('Usuário sem empresa vinculada')
    return companyId
  }

  private toLocation(row: { lat: number | null; lng: number | null }): WeatherLocation {
    const loc = locationOf(row)
    return { lat: loc.lat, lng: loc.lng, configured: loc !== SITE_LOCATION }
  }

  private async locationFor(companyId?: string | null): Promise<SiteLocation> {
    if (!companyId) return SITE_LOCATION
    const row = await this.prisma.company.findUnique({ where: { id: companyId }, select: { lat: true, lng: true } })
    return locationOf(row)
  }

  private async read(loc: SiteLocation, now: Date): Promise<ReadingState | null> {
    const key = locationKey(loc)
    const cached = this.lastGood.get(key)
    const age = cached ? now.getTime() - cached.at : Infinity
    if (cached && age < FRESH_MS) return { ...cached, stale: false }
    try {
      const reading = await this.provider.fetch(loc)
      const fresh = { reading, at: now.getTime() }
      this.lastGood.set(key, fresh)
      return { ...fresh, stale: false }
    } catch (err) {
      this.logger.warn(`open-meteo indisponível em ${key}: ${String(err)}`)
      return cached && age < STALE_MAX_MS ? { ...cached, stale: true } : null
    }
  }

  private realAlerts(state: ReadingState | null, now: Date): WeatherAlert[] {
    if (!state?.reading.hazards) return []
    return evaluateWeatherAlerts(state.reading.hazards, now, state.reading.utcOffsetSeconds ?? DEFAULT_UTC_OFFSET_SECONDS)
  }

  // Série horária canned resolvida em runtime (offsets → ISO a partir de `now`).
  private cannedHourly(now: Date): WeatherHourly[] {
    return CANNED_HOURLY.map((h) => {
      const at = new Date(now.getTime() + h.offsetH * 3_600_000)
      return {
        at: at.toISOString(),
        tempC: h.tempC,
        condition: h.condition,
        // Canned não tem is_day real; deriva da hora local (06–18 = dia).
        isDay: at.getHours() >= 6 && at.getHours() < 18,
      }
    })
  }
}
