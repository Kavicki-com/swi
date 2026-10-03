import { useEffect, useMemo, useState } from 'react'
import {
  pickActiveAlert,
  weatherApi,
  type WeatherAlertDto,
  type WeatherAlertsView,
} from '@/services/api/weather'

// O clima não tem canal ao vivo: o painel relê o GET /weather neste intervalo.
export const WEATHER_ALERT_REFRESH_MS = 5 * 60_000

export interface UseWeatherAlertResult {
  // null = sem alerta vigente (ou ainda carregando a primeira leitura).
  alert: WeatherAlertDto | null
  // O alerta mostrado veio de uma resposta com dado de demonstração.
  demo: boolean
}

const EMPTY: WeatherAlertsView = { alerts: [], demo: false }

// Alerta meteorológico vigente da empresa do token. A cada tique relê a API e
// reavalia a validade com o relógio de agora: leitura que falha mantém a última
// lista boa, mas alerta expirado some mesmo sem leitura nova.
export function useWeatherAlert(): UseWeatherAlertResult {
  const [view, setView] = useState<WeatherAlertsView>(EMPTY)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    const read = () => {
      void weatherApi.alerts().then((res) => {
        if (cancelled) return
        if (res.data) setView(res.data)
        setNowMs(Date.now())
      })
    }
    read()
    const timer = setInterval(read, WEATHER_ALERT_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return useMemo(() => {
    const alert = pickActiveAlert(view.alerts, nowMs)
    return { alert, demo: alert !== null && view.demo }
  }, [view, nowMs])
}
