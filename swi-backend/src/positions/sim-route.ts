// Núcleo PURO do simulador dev de posições (sem Date/random — determinístico,
// testável). Cada worker anda num loop fechado dentro da área do site (mesma
// vizinhança da SITE_ROUTE de evacuation.types.ts).

export type LngLat = [number, number]

export interface SimState {
  seg: number // índice do segmento atual na polilinha
  t: number // fração [0,1) percorrida do segmento
}

// Aproximação equiretangular suficiente pra ~1 km na latitude do site.
const M_PER_DEG_LAT = 111_320
const mPerDegLng = (lat: number): number => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

// Loop base: polígono dentro do site do piloto (entre a origem e o destino
// da SITE_ROUTE). Cada worker ganha o loop deslocado por um offset derivado
// do índice — determinístico, espalha os pinos sem random.
const BASE_LOOP: LngLat[] = [
  [-46.631, -23.551],
  [-46.6265, -23.5515],
  [-46.6235, -23.549],
  [-46.6275, -23.5465],
  [-46.6305, -23.548],
]

export function loopForWorker(index: number): LngLat[] {
  const dLng = ((index % 5) - 2) * 0.0008
  const dLat = ((Math.floor(index / 5) % 5) - 2) * 0.0006
  return BASE_LOOP.map(([lng, lat]) => [lng + dLng, lat + dLat])
}

const segmentMeters = (a: LngLat, b: LngLat): number => {
  const midLat = (a[1] + b[1]) / 2
  const dx = (b[0] - a[0]) * mPerDegLng(midLat)
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT
  return Math.hypot(dx, dy)
}

export const distanceMeters = segmentMeters

// Ponto de encontro da evacuação simulada — centro da área dos loops. Em
// produção o muster real vem do site (SITE_ROUTE.destination no mobile).
export const MUSTER_POINT: LngLat = [-46.6275, -23.549]

// Passo em linha reta na direção do alvo, clampando SEM overshoot: chegou,
// fica exatamente no alvo (o simulador usa igualdade pra disparar o ack).
export function stepToward(
  cur: LngLat,
  target: LngLat,
  dtSec: number,
  speedMps: number,
): LngLat {
  const dist = segmentMeters(cur, target)
  const step = dtSec * speedMps
  if (step >= dist || dist === 0) return [target[0], target[1]]
  const f = step / dist
  return [cur[0] + (target[0] - cur[0]) * f, cur[1] + (target[1] - cur[1]) * f]
}

export function advance(
  route: LngLat[],
  state: SimState,
  dtSec: number,
  speedMps: number,
): { state: SimState; pos: LngLat } {
  let { seg, t } = state
  let budget = dtSec * speedMps
  // Percorre segmentos até gastar a distância do passo (com wrap no loop).
  // Guarda de laço: cada iteração ou zera o budget ou avança um segmento.
  for (let guard = 0; guard < 10_000 && budget > 0; guard++) {
    const a = route[seg % route.length]
    const b = route[(seg + 1) % route.length]
    const len = segmentMeters(a, b)
    const remaining = (1 - t) * len
    if (budget < remaining) {
      t += budget / len
      budget = 0
    } else {
      budget -= remaining
      seg = (seg + 1) % route.length
      t = 0
    }
  }
  const a = route[seg % route.length]
  const b = route[(seg + 1) % route.length]
  const pos: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return { state: { seg, t }, pos }
}
