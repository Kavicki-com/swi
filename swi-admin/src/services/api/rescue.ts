// Candidatos a socorro — derivados de QUEM EXISTE e de ONDE ESTÁ.
//
// Antes: fixture com 4 pessoas fixas ("Lúcio Ferreira", "Ana Clara Silva"…) que
// não constavam no diretório da empresa, com distância e ETA inventados. Num
// console de emergência isso é pior que inútil: manda socorro pra quem não
// existe (QA de volume 2026-07-26).
//
// Agora: cruza as POSIÇÕES ao vivo (GET /positions) com o diretório real. Quem
// não tem posição conhecida não é candidato — não dá pra prometer ETA de quem
// o sistema não sabe onde está.
import type { DashboardMapMarker } from './dashboard'
import type { Employee } from './users'
import { simulatedVitalsFor } from '@/services/vitals/simulatedVitals'

export type RescueCandidateStatus = 'good' | 'alert' | 'low'

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

const TIER_TO_HEALTH: Record<string, RescueCandidateStatus> = {
  excelente: 'good',
  desgastado: 'alert',
  'alerta-fadiga': 'low',
}

/**
 * Puro: ranqueia os colegas do ferido por distância real.
 *
 * `directory` enriquece com identidade (nome/idade/tipo sanguíneo/foto); quem
 * não estiver nele ainda aparece pelo marker, porque estar no mapa já prova que
 * existe. O status de saúde vem do mesmo gerador simulado do resto do app.
 */
export function rankRescueCandidates(
  injuredId: string,
  positions: ReadonlyArray<DashboardMapMarker>,
  directory: ReadonlyArray<Employee>,
): RescueCandidate[] {
  const injured = positions.find((p) => p.id === injuredId)
  if (!injured) return []
  const byId = new Map(directory.map((e) => [e.id, e]))
  const now = Date.now()

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
        healthStatus: TIER_TO_HEALTH[simulatedVitalsFor(p.id, now).tier] ?? 'good',
      }
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map((c, i) => ({ ...c, isBestOption: i === 0 }))
}
