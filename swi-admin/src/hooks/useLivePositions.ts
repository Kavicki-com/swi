import { useEffect, useState } from 'react'
import type { DashboardMapMarker } from '@/services/api/dashboard'
import { positionsApi, toDashboardMarker } from '@/services/api/positions'
import { subscribePositions } from '@/services/positions/positionsSocket'

// Upsert por id: heartbeat de worker já listado move o pino; worker novo
// (contratado depois do load inicial) entra na lista.
export function applyMarker(
  list: DashboardMapMarker[],
  marker: DashboardMapMarker,
): DashboardMapMarker[] {
  const idx = list.findIndex((m) => m.id === marker.id)
  if (idx === -1) return [...list, marker]
  const next = [...list]
  next[idx] = marker
  return next
}

// Posições ao vivo pros mapas: snapshot inicial via REST + updates via WS.
// null = ainda carregando (mesma semântica dos states que este hook substitui).
export function useLivePositions(): DashboardMapMarker[] | null {
  const [markers, setMarkers] = useState<DashboardMapMarker[] | null>(null)

  useEffect(() => {
    let cancelled = false
    positionsApi.list().then((res) => {
      // Erro degrada pra [] (mapa vazio, página viva) — contrato das fachadas envelope.
      if (!cancelled) setMarkers(res.data ?? [])
    })
    const unsubscribe = subscribePositions((dto) => {
      const marker = toDashboardMarker(dto)
      setMarkers((cur) => applyMarker(cur ?? [], marker))
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return markers
}
