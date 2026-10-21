import { BadRequestException } from '@nestjs/common'

// Polígono da área de evacuação demarcado ao iniciar. Vértices [lng, lat]
// (convenção maplibre/GeoJSON). A marcação é VISUAL e por evacuação: não muda
// a semântica company-wide (quem é notificado continua sendo a org inteira).
// Persistido como anel fechado (primeiro vértice repetido no fim) para casar
// com o Polygon do GeoJSON que o painel desenha.

export type AreaVertex = [number, number]

const MIN_VERTICES = 3

function isCoord(x: unknown, min: number, max: number): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max
}

function isValidVertex(v: unknown): v is AreaVertex {
  if (!Array.isArray(v) || v.length !== 2) return false
  const [lng, lat] = v as [unknown, unknown]
  return isCoord(lng, -180, 180) && isCoord(lat, -90, 90)
}

function sameVertex(a: AreaVertex, b: AreaVertex): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

/**
 * Valida e normaliza a área recebida no disparo da evacuação.
 * Sem área (null/undefined) é aceito: a evacuação segue sem recorte visual.
 * Quando há área, exige ao menos 3 vértices distintos [lng, lat] e devolve o
 * anel fechado. Entrada inválida vira 400.
 */
export function normalizeEvacuationArea(area: unknown): AreaVertex[] | null {
  if (area === null || area === undefined) return null
  if (!Array.isArray(area)) {
    throw new BadRequestException('Área da evacuação precisa ser uma lista de vértices')
  }
  const vertices: AreaVertex[] = area.map((v) => {
    if (!isValidVertex(v)) {
      throw new BadRequestException('Cada vértice precisa ser um par [lng, lat] dentro dos limites do globo')
    }
    return [v[0], v[1]]
  })

  // Tira o ponto de fechamento repetido para contar só os vértices distintos.
  const open =
    vertices.length >= 2 && sameVertex(vertices[0], vertices[vertices.length - 1])
      ? vertices.slice(0, -1)
      : vertices
  if (open.length < MIN_VERTICES) {
    throw new BadRequestException('A área precisa de ao menos 3 vértices')
  }
  return [...open, open[0]]
}

/**
 * Valida e normaliza o ponto de encontro marcado no disparo da evacuação,
 * [lng, lat]. Obrigatório: é o destino da rota de cada funcionário, e sem ele
 * não há para onde mandar ninguém. Ausente ou inválido vira 400.
 */
export function normalizeMusterPoint(point: unknown): AreaVertex {
  if (point === null || point === undefined) {
    throw new BadRequestException('Marque o ponto de encontro da evacuação')
  }
  if (!isValidVertex(point)) {
    throw new BadRequestException(
      'O ponto de encontro precisa ser um par [lng, lat] dentro dos limites do globo',
    )
  }
  return [point[0], point[1]]
}
