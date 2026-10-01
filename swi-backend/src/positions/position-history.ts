// Regras puras da trilha de posições: quando uma posição nova vira amostra e
// como as amostras viram o mapa de calor. Nada aqui fala com o banco; o
// serviço consulta e grava, e a mesma grade é calculada no SQL do agregado,
// então as duas pontas usam as constantes daqui.

export interface LatLng {
  lat: number
  lng: number
}

export interface PositionSamplePoint extends LatLng {
  workerId: string
  recordedAt: Date
}

export interface HeatCell extends LatLng {
  weight: number
}

/**
 * Espaçamento mínimo entre amostras do mesmo funcionário. O heartbeat chega a
 * cada 10 s; gravar todos encheria a tabela de pontos repetidos de quem está
 * parado. Uma amostra nova entra quando passou ao menos este intervalo desde a
 * última OU quando o funcionário andou ao menos SAMPLE_MIN_DISTANCE_M.
 */
export const SAMPLE_MIN_INTERVAL_MS = 60_000
export const SAMPLE_MIN_DISTANCE_M = 25

/** Lado da célula do mapa de calor, em metros. */
export const HEAT_CELL_SIZE_M = 50

const EARTH_RADIUS_M = 6_371_000
/** Metros por grau de latitude no raio médio da Terra. */
export const METERS_PER_DEGREE = (Math.PI * EARTH_RADIUS_M) / 180

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Distância de superfície (haversine), em metros. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function shouldRecordSample(
  last: (LatLng & { recordedAt: Date }) | null,
  next: LatLng,
  now: Date,
): boolean {
  if (last === null) return true
  if (now.getTime() - last.recordedAt.getTime() >= SAMPLE_MIN_INTERVAL_MS) return true
  return distanceM(last, next) >= SAMPLE_MIN_DISTANCE_M
}

/** Altura da célula em graus de latitude: constante no globo inteiro. */
export function latStepDeg(cellSizeM = HEAT_CELL_SIZE_M): number {
  return cellSizeM / METERS_PER_DEGREE
}

/**
 * Largura da célula em graus de longitude, calculada no centro da faixa de
 * latitude da linha. Assim toda célula tem o lado em metros nas duas direções
 * e a grade não depende dos dados consultados: a mesma posição cai sempre na
 * mesma célula, em qualquer consulta.
 */
export function lngStepDeg(row: number, cellSizeM = HEAT_CELL_SIZE_M): number {
  const bandCenterLat = (row + 0.5) * latStepDeg(cellSizeM)
  return cellSizeM / (METERS_PER_DEGREE * Math.cos(toRad(bandCenterLat)))
}

/** Célula da posição. A borda inferior e a esquerda pertencem à célula. */
export function cellOf(point: LatLng, cellSizeM = HEAT_CELL_SIZE_M): { row: number; col: number } {
  const row = Math.floor(point.lat / latStepDeg(cellSizeM))
  const col = Math.floor(point.lng / lngStepDeg(row, cellSizeM))
  return { row, col }
}

export function cellCenter(row: number, col: number, cellSizeM = HEAT_CELL_SIZE_M): LatLng {
  return {
    lat: (row + 0.5) * latStepDeg(cellSizeM),
    lng: (col + 0.5) * lngStepDeg(row, cellSizeM),
  }
}

const minuteOf = (instant: Date) => Math.floor(instant.getTime() / 60_000)

/**
 * Mapa de calor das amostras. O peso de uma célula é o número de minutos
 * distintos de funcionário passados nela: o mesmo funcionário com três
 * amostras no mesmo minuto conta uma vez, e dois funcionários no mesmo minuto
 * contam dois. Assim o peso mede presença, e não a frequência com que o
 * celular de alguém reporta. Células mais quentes primeiro.
 */
export function aggregateHeat(
  samples: readonly PositionSamplePoint[],
  cellSizeM = HEAT_CELL_SIZE_M,
): HeatCell[] {
  const cells = new Map<string, { row: number; col: number; minutes: Set<string> }>()
  for (const s of samples) {
    const { row, col } = cellOf(s, cellSizeM)
    const key = `${row}:${col}`
    let cell = cells.get(key)
    if (!cell) {
      cell = { row, col, minutes: new Set() }
      cells.set(key, cell)
    }
    cell.minutes.add(`${s.workerId}|${minuteOf(s.recordedAt)}`)
  }
  return [...cells.values()]
    .map(({ row, col, minutes }) => ({ ...cellCenter(row, col, cellSizeM), weight: minutes.size }))
    .sort((a, b) => b.weight - a.weight)
}
