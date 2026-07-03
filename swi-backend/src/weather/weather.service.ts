import { Injectable, Logger } from '@nestjs/common'
import { OpenMeteoProvider } from './weather.provider'
import { CANNED_CURRENT, CANNED_DAILY, DEMO_STORM_ALERT_ID } from './weather.types'
import type { WeatherAlert, WeatherSnapshot } from './weather.types'

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
    try {
      const real = await this.provider.fetch()
      current = real.current; daily = real.daily
    } catch (err) {
      // fallback canned — tela de segurança nunca pode quebrar
      this.logger.warn(`open-meteo indisponível, servindo fallback canned: ${err}`)
    }
    return { current, daily, alerts: this.alerts(now), fetchedAt: now.toISOString() }
  }

  // Alerta: dev via WEATHER_SCENARIO='alert'; prod → fonte real (ainda não
  // configurada = []). NUNCA fabrica alerta sem flag/fonte.
  private alerts(now: Date): WeatherAlert[] {
    return process.env.WEATHER_SCENARIO === 'alert' ? [stormAlert(now)] : []
  }
}
