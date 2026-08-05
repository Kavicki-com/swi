// src/pages/dashboard/components/WeatherStrip.tsx
// Faixa de previsão do tempo do rodapé do dashboard. Extraída de
// Dashboard.tsx: o mapeamento de condição, o formatador de hora e o cálculo
// dos eventos vinham do corpo de DashboardContent e vieram junto.
import { View } from 'react-native'
import { Title, WeatherTimeline, useTheme } from '@kavicki/swi-design-system'
import type { DashboardSummary } from '@/services/dashboard'

// DS module is shimmed to `any`; mirror the WeatherTimelineEvent shape locally.
type WeatherTimelineCondition = 'sunny' | 'rainy' | 'partly-cloudy' | 'storm'
type WeatherTimelineEvent = {
  id: string
  condition: WeatherTimelineCondition
  isNight?: boolean
  time: string
  label: string
  isNow?: boolean
}

const WEATHER_NOW_LABEL = 'AGORA'

const WEATHER_CONDITION_MAP: Record<
  DashboardSummary['weather'][number]['condition'],
  WeatherTimelineEvent['condition']
> = {
  sun: 'sunny',
  cloudy: 'partly-cloudy',
  rain: 'rainy',
  storm: 'storm',
}

const formatHourLabel = (iso: string): string => {
  // Spec format: "09:00AM" — 12-hour with AM/PM, no space.
  const d = new Date(iso)
  const hours24 = d.getHours()
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 || 12
  const minutes = d.getMinutes()
  return `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')}${period}`
}

export function WeatherStrip({ weather }: { weather: DashboardSummary['weather'] }) {
  const theme = useTheme()
  const weatherEvents: WeatherTimelineEvent[] = weather.map((w, idx) => ({
    id: `weather-${idx}`,
    condition: WEATHER_CONDITION_MAP[w.condition],
    isNight: w.isNight,
    time: formatHourLabel(w.at),
    label: w.label ?? `${w.tempC}°C`,
    isNow: w.isNow,
  }))

  return (
    <View style={{ alignSelf: 'stretch', width: '100%', gap: theme.gap.m }}>
      <Title>Previsão do tempo</Title>
      <WeatherTimeline
        events={weatherEvents}
        // Spec flex: 280, 280, 280, 528 → ratios 1, 1, 1, 1.886.
        // Colors per spec: blue (rain), orange (sol intenso), blue (rain), green-dark (parcialmente nublado).
        intensitySegments={[
          { id: 'seg-0', flex: 1, color: '#3899bf' },
          { id: 'seg-1', flex: 1, color: theme.surface.warning },
          { id: 'seg-2', flex: 1, color: '#3899bf' },
          { id: 'seg-3', flex: 1.886, color: theme.surface.success },
        ]}
        // Scrubber: 148px thumb on 1037px track ≈ 14%.
        scrollbar={{ thumbPercent: 14, thumbStartPercent: 0 }}
        nowLabel={WEATHER_NOW_LABEL}
        fullWidth
        testID="weather-timeline"
      />
    </View>
  )
}
