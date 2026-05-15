// src/services/mockApi/rescue.ts
// Mock data for /alerts/:employeeId/rescue (Figma 101:7484 — rescue-route
// selection). Returns a deterministic list of nearby candidate rescuers so
// the screen always renders the same content for demo purposes.
import { sleep } from './sleep'
import type { MockResponse } from './types'
import rescueAvatar1 from '@/assets/avatars/rescue/rescue-1.png'
import rescueAvatar2 from '@/assets/avatars/rescue/rescue-2.png'
import rescueAvatar3 from '@/assets/avatars/rescue/rescue-3.png'
import rescueAvatar4 from '@/assets/avatars/rescue/rescue-4.png'

/** Health bucket used by the chip filter on /alerts/:id/rescue
 * (Figma 101:7484 — "Sem incidentes" / "Risco de incidente" / "Urgência médica").
 * Values mirror the chip values to keep filter mapping trivial. */
export type RescueCandidateStatus = 'good' | 'alert' | 'low'

export type RescueCandidate = {
  id: string
  name: string
  age: number
  bloodType: string
  avatarUri: string
  distanceKm: number
  etaMinutes: number
  /** Highlight as "Melhor opção de ajuda" — only one candidate per list. */
  isBestOption: boolean
  healthStatus: RescueCandidateStatus
}

// Fixture mirrors the rows in Figma 101:7484 exactly (name/age/blood/eta).
// Construction-worker themed avatars are sourced from Unsplash via faceareas
// so the visual matches the helmet-on-portraits the Figma uses.
const RESCUE_FIXTURE: ReadonlyArray<RescueCandidate> = [
  {
    id: 'rescue-1',
    name: 'Lúcio Ferreira dos Santos',
    age: 41,
    bloodType: 'B+',
    avatarUri: rescueAvatar1,
    distanceKm: 3,
    etaMinutes: 6,
    isBestOption: true,
    healthStatus: 'good',
  },
  {
    id: 'rescue-2',
    name: 'Ana Clara Silva',
    age: 45,
    bloodType: 'B-',
    avatarUri: rescueAvatar2,
    distanceKm: 7,
    etaMinutes: 12,
    isBestOption: false,
    healthStatus: 'good',
  },
  {
    id: 'rescue-3',
    name: 'Lucas Fernandes Nascimento',
    age: 42,
    bloodType: 'O+',
    avatarUri: rescueAvatar3,
    distanceKm: 9,
    etaMinutes: 17,
    isBestOption: false,
    healthStatus: 'alert',
  },
  {
    id: 'rescue-4',
    name: 'Antonio Gomes',
    age: 29,
    bloodType: 'A+',
    avatarUri: rescueAvatar4,
    distanceKm: 19,
    etaMinutes: 32,
    isBestOption: false,
    healthStatus: 'low',
  },
]

export const rescueApi = {
  candidates: async (_opts: {
    injuredEmployeeId: string
  }): Promise<MockResponse<RescueCandidate[]>> => {
    await sleep(80)
    return { data: [...RESCUE_FIXTURE], error: null }
  },
}
