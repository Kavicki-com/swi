import { useEffect, useState } from 'react'
import type { DashboardMapMarker } from '@/services/api/dashboard'
import { positionsApi, toDashboardMarker } from '@/services/api/positions'
import { subscribePositions } from '@/services/positions/positionsSocket'
import { connectionStatus } from '@/services/realtime/connectionStatus'

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

const isNewer = (a: DashboardMapMarker, b: DashboardMapMarker): boolean =>
  !!a.recordedAt && !!b.recordedAt && Date.parse(a.recordedAt) > Date.parse(b.recordedAt)

// Retrato do servidor na volta da conexão: vale a lista dele, mas o pino que
// chegou pelo socket depois do retrato fica, para não voltar para trás.
export function mergeSnapshot(
  snapshot: DashboardMapMarker[],
  current: DashboardMapMarker[],
): DashboardMapMarker[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  return snapshot.map((m) => {
    const onScreen = byId.get(m.id)
    return onScreen && isNewer(onScreen, m) ? onScreen : m
  })
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
    // As posições que chegaram durante uma queda do socket se perderam: a
    // volta da conexão relê a lista inteira. Falha nessa releitura mantém os
    // pinos que já estão na tela.
    const stopReconnect = connectionStatus.onReconnect(() => {
      positionsApi.list().then((res) => {
        const snapshot = res.data
        if (!cancelled && snapshot) setMarkers((cur) => mergeSnapshot(snapshot, cur ?? []))
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
      stopReconnect()
    }
  }, [])

  return markers
}
