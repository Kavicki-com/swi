// Wrapper de useEffect + state pro fetchRoute. Expoe { route, loading,
// error } pra que AlertsRescueRoute consuma de forma declarativa.

import { useEffect, useState } from 'react'
import { fetchRoute, type LngLat, type RouteResult } from '@/lib/mapboxDirections'

export type RescueRouteState = {
  route: RouteResult | null
  loading: boolean
  error: boolean
}

export function useRescueRoute(from: LngLat, to: LngLat): RescueRouteState {
  const [state, setState] = useState<RescueRouteState>({
    route: null,
    loading: true,
    error: false,
  })

  useEffect(() => {
    let cancelled = false
    setState({ route: null, loading: true, error: false })
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
  }, [from[0], from[1], to[0], to[1]])

  return state
}
