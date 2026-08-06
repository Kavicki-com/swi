import { Injectable, Logger } from '@nestjs/common'
import { OpenMeteoProvider } from './weather.provider'
import { CANNED_CURRENT, CANNED_DAILY, CANNED_HOURLY, DEMO_STORM_ALERT_ID } from './weather.types'
import type { WeatherAlert, WeatherHourly, WeatherSnapshot } from './weather.types'

const STORM_DESC =
  'Risco de desabamentos nas primeiras horas do dia, procure a rota de siga as instruções para a evacuação.'

// Alerta canned de demo (paridade com o mockWeatherBackend). Id 'wx-0' estável
// pro dedup do cron; startsAt/endsAt na hora → alerta SEMPRE vigente.
function stormAlert(now: Date): WeatherAlert {
  return {
    id: DEMO_STORM_ALERT_ID,
    event: 'Tempestade severa',
    description: STORM_DESC,
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  }
}

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name)

  constructor(private readonly provider: OpenMeteoProvider) {}

  async getSnapshot(): Promise<WeatherSnapshot> {
    const now = new Date()
    let current = CANNED_CURRENT, daily = CANNED_DAILY
    let hourly: WeatherHourly[] = this.cannedHourly(now)
    try {
      const real = await this.provider.fetch()
      current = real.current; daily = real.daily
      hourly = real.hourly?.length ? real.hourly : this.cannedHourly(now)
    } catch (err) {
      // fallback canned — tela de segurança nunca pode quebrar
      this.logger.warn(`open-meteo indisponível, servindo fallback canned: ${String(err)}`)
    }
    return { current, daily, hourly, alerts: this.alerts(now), fetchedAt: now.toISOString() }
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

  // Alerta: dev via WEATHER_SCENARIO='alert'; prod → fonte real (ainda não
  // configurada = []). NUNCA fabrica alerta sem flag/fonte.
  private alerts(now: Date): WeatherAlert[] {
    // O ambiente vem antes da flag: em produção, alerta só pode nascer de fonte
    // real. Um alerta fabricado aqui mandaria gente evacuar sem tempestade.
    if (process.env.NODE_ENV === 'production') return []
    return process.env.WEATHER_SCENARIO === 'alert' ? [stormAlert(now)] : []
  }
}
