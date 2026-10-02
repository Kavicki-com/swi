// Candidatos a socorro, derivados de QUEM EXISTE e de ONDE ESTÁ.
//
// A lista cruza as POSIÇÕES ao vivo (GET /positions) com o diretório real da
// empresa. Nenhum nome fixo entra aqui: num console de emergência uma pessoa
// que não está no diretório manda socorro pra quem não existe.
//
// Quem não tem posição conhecida não é candidato. Não dá pra prometer distância
// nem ETA de quem o sistema não sabe onde está.
import type { DashboardMapMarker } from './dashboard'
import type { Employee } from './users'
import type { HealthStatus } from '@/services/vitals/healthStatus'

/** Mesmo estado da régua de saúde: 'unknown' é quem não tem leitura atual. */
export type RescueCandidateStatus = HealthStatus

export type RescueCandidate = {
  id: string
  name: string
  age: number
  bloodType: string
  avatarUri: string
  distanceKm: number
  etaMinutes: number
  /** Só UM candidato recebe o destaque "Melhor opção de ajuda": o mais próximo. */
  isBestOption: boolean
  healthStatus: RescueCandidateStatus
}

// Mesma aproximação equiretangular do simulador do backend (sim-route.ts) —
// exata o bastante na escala de um site industrial.
const M_PER_DEG_LAT = 111_320
const WALK_SPEED_MPS = 1.4

function metersBetween(a: DashboardMapMarker, b: DashboardMapMarker): number {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  const dx = (b.lng - a.lng) * M_PER_DEG_LAT * Math.cos(midLat)
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT
  return Math.hypot(dx, dy)
}

/**
 * Puro: ranqueia os colegas do ferido por distância real.
 *
 * `directory` enriquece com identidade (nome/idade/tipo sanguíneo/foto); quem
 * não estiver nele ainda aparece pelo marker, porque estar no mapa já prova que
 * existe. O estado de saúde vem de `healthById`, decidido pelas condições
 * abertas de cada pessoa; quem não está no mapa é 'unknown', nunca "bom".
 */
export function rankRescueCandidates(
  injuredId: string,
  positions: ReadonlyArray<DashboardMapMarker>,
  directory: ReadonlyArray<Employee>,
  healthById: ReadonlyMap<string, RescueCandidateStatus> = new Map(),
): RescueCandidate[] {
  const injured = positions.find((p) => p.id === injuredId)
  if (!injured) return []
  const byId = new Map(directory.map((e) => [e.id, e]))

  return positions
    .filter((p) => p.id !== injuredId)
    .map((p) => {
      const meters = metersBetween(injured, p)
      const person = byId.get(p.id)
      return {
        id: p.id,
        name: person?.name ?? p.name,
        age: person?.age ?? 0,
        bloodType: person?.bloodType ?? '—',
        avatarUri: person?.avatarUri || p.avatarUri,
        distanceKm: Math.round((meters / 1000) * 100) / 100,
        // Piso de 1 min: "0 minutos" soaria como teletransporte.
        etaMinutes: Math.max(1, Math.round(meters / WALK_SPEED_MPS / 60)),
        isBestOption: false,
        healthStatus: healthById.get(p.id) ?? 'unknown',
      }
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map((c, i) => ({ ...c, isBestOption: i === 0 }))
}
