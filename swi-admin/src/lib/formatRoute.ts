// Formata duration (segundos) e distance (metros) vindos da Mapbox
// Directions API pros labels visiveis na tela de rescue. Replica o
// estilo dos labels Figma hardcoded ("6 minutos", "16 Km", "17 minutos").

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return `${total} s`
  const min = Math.round(total / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const remMin = min % 60
  return `${h}h ${remMin}min`
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  const km = meters / 1000
  if (km >= 10) return `${Math.round(km)} Km`
  return `${km.toFixed(1)} Km`
}
