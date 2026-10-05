import { useMemo } from 'react'
import { useNow } from '@/hooks/useNow'
import type { DashboardMapMarker } from '@/services/dashboard'
import { POSITION_CLOCK_MS, stalePinTitle } from '@/services/positions/positionAge'

// Texto de passar o mouse de cada pino do mapa geral, na ordem dos pinos: só
// quem está com a posição velha ganha a hora. O relógio anda a cada 30 s, mas
// a lista só troca de identidade quando algum texto muda (um pino cruzou o
// limiar ou a lista de pinos mudou), e é isso que os pinos usam para se refazer.
export function useStalePinTitles(
  markers: ReadonlyArray<DashboardMapMarker>,
): ReadonlyArray<string | undefined> {
  const now = useNow(POSITION_CLOCK_MS)
  const key = JSON.stringify(markers.map((m) => stalePinTitle(m.name, m.recordedAt, now) ?? null))
  return useMemo(() => (JSON.parse(key) as Array<string | null>).map((t) => t ?? undefined), [key])
}
