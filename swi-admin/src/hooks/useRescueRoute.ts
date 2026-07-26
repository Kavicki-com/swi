// Wrapper de useEffect + state pro fetchRoute. Expoe { route, loading,
// error } pra que AlertsRescueRoute consuma de forma declarativa.

import { useEffect, useState } from 'react'
import { fetchRoute, type LngLat, type RouteResult } from '@/lib/mapboxDirections'

export type RescueRouteState = {
  route: RouteResult | null
  loading: boolean
  error: boolean
}

/**
 * `from`/`to` aceitam null: as pontas do socorro saem das posições AO VIVO
 * (GET /positions), que chegam depois do primeiro render. Enquanto uma delas
 * for desconhecida o hook fica em `loading` — pedir rota pra coordenada
 * inventada devolveria um trajeto que não é de ninguém.
 */
export function useRescueRoute(from: LngLat | null, to: LngLat | null): RescueRouteState {
  const [state, setState] = useState<RescueRouteState>({
    route: null,
    loading: true,
    error: false,
  })

  useEffect(() => {
    let cancelled = false
    setState({ route: null, loading: true, error: false })
    if (!from || !to) return
    fetchRoute({ from, to })
      .then((route) => {
        if (cancelled) return
        if (route === null) {
          setState({ route: null, loading: false, error: true })
        } else {
          setState({ route, loading: false, error: false })
        }
      })
      .catch(() => {
        if (cancelled) return
        setState({ route: null, loading: false, error: true })
      })
    return () => {
      cancelled = true
    }
    // Re-fetch on coordinate changes only (object identity may flap each render).
  }, [from?.[0], from?.[1], to?.[0], to?.[1]])

  return state
}
