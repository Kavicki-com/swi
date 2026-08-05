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

  // As pontas chegam num array NOVO a cada poll de posições, então depender das
  // tuplas faria o efeito rodar a cada render. Os escalares saem daqui e as
  // tuplas são remontadas dentro do efeito: a lista de dependências fica
  // completa e checável pelo lint, sem suppression e sem busca espúria.
  const fromLng = from?.[0]
  const fromLat = from?.[1]
  const toLng = to?.[0]
  const toLat = to?.[1]

  useEffect(() => {
    let cancelled = false
    setState({ route: null, loading: true, error: false })
    // Comparação com undefined, não checagem de truthiness: 0 é longitude e
    // latitude legítimas (Greenwich, Equador) e não pode contar como ausente.
    if (fromLng === undefined || fromLat === undefined) return
    if (toLng === undefined || toLat === undefined) return
    fetchRoute({ from: [fromLng, fromLat], to: [toLng, toLat] })
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
  }, [fromLng, fromLat, toLng, toLat])

  return state
}
