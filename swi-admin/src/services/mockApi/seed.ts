import type { User, Employee, Alert, ISODateString } from '../types'
import adminAvatar from '@/assets/header/admin-avatar.png'
import { ROSTER, type WorkerProfile } from './roster'

const minutesAgo = (n: number): ISODateString => new Date(Date.now() - n * 60_000).toISOString()
const hoursAgo = (n: number): ISODateString => minutesAgo(n * 60)
const daysAgo = (n: number): ISODateString => hoursAgo(n * 24)

export const SEED_ORG_ID = 'org_seed_1'

export const SEED_ADMIN: User = {
  id: 'u_seed_1',
  org_id: SEED_ORG_ID,
  email: 'admin@swi.test',
  full_name: 'Admin Seed',
  role: 'super_admin',
  consent_given_at: daysAgo(30),
  created_at: daysAgo(60),
  bpm: 99,
  pressure: '12/8',
  avatarUri: adminAvatar,
}

// Adapter: roster Person → Employee (API shape per ../types). Bridges the
// 3-state vitalsStatus + isOnline pair onto the 4-state API status, formats
// allergies as a comma-joined string (or null when empty), and stamps ISO
// timestamps from the roster's relative offsets.
function toEmployeeApi(p: WorkerProfile, orgId: string): Employee {
  const status: Employee['status'] = !p.isOnline
    ? 'offline'
    : p.vitalsStatus === 'good'
      ? 'good'
      : p.vitalsStatus === 'warning'
        ? 'alert'
        : 'low'
  return {
    id: p.id,
    org_id: orgId,
    full_name: p.name,
    cpf: p.cpf,
    blood_type: p.bloodType,
    allergies: p.allergies.length > 0 ? p.allergies.join(', ') : null,
    status,
    last_location: p.location
      ? {
          lat: p.location.lat,
          lng: p.location.lng,
          updated_at: minutesAgo(p.lastSeenMinutesAgo),
        }
      : null,
    created_at: daysAgo(p.createdDaysAgo),
  }
}

export const SEED_EMPLOYEES: Employee[] = ROSTER.map((p) => toEmployeeApi(p, SEED_ORG_ID))

// Demo alerts — each one points at a roster member by canonical ID so a click
// from /alerts → /employees/:id lands on the same person. Severity tracks the
// target's vitalsStatus so the demo reads consistently (warning alert on a
// warning worker, critical alert on a critical worker, etc.).
export const SEED_ALERTS: Alert[] = [
  {
    id: 'a_001',
    org_id: SEED_ORG_ID,
    employee_id: 'emp-02', // Ana Paula Gomes — vitalsStatus warning
    severity: 'warning',
    state: 'open',
    type: 'health',
    message: 'Frequência cardíaca elevada',
    created_at: minutesAgo(8),
    acknowledged_at: null,
    closed_at: null,
  },
  {
    id: 'a_002',
    org_id: SEED_ORG_ID,
    employee_id: 'emp-04', // Carlos Henrique Silva — vitalsStatus critical
    severity: 'critical',
    state: 'acknowledged',
    type: 'health',
    message: 'Possível queda detectada',
    created_at: minutesAgo(15),
    acknowledged_at: minutesAgo(12),
    closed_at: null,
  },
  {
    id: 'a_003',
    org_id: SEED_ORG_ID,
    employee_id: 'emp-06', // Pedro Martins Lima
    severity: 'info',
    state: 'closed',
    type: 'meteorologic',
    message: 'Aviso de chuva forte na região',
    created_at: hoursAgo(2),
    acknowledged_at: hoursAgo(2),
    closed_at: hoursAgo(1),
  },
  {
    id: 'a_004',
    org_id: SEED_ORG_ID,
    employee_id: 'emp-01', // Larissa Sales
    severity: 'warning',
    state: 'closed',
    type: 'health',
    message: 'Bateria baixa do dispositivo',
    created_at: hoursAgo(5),
    acknowledged_at: hoursAgo(5),
    closed_at: hoursAgo(4),
  },
  {
    id: 'a_005',
    org_id: SEED_ORG_ID,
    employee_id: 'emp-07', // Amanda Costa Pereira
    severity: 'info',
    state: 'closed',
    type: 'manual',
    message: 'Início de jornada confirmado',
    created_at: hoursAgo(8),
    acknowledged_at: hoursAgo(8),
    closed_at: hoursAgo(8),
  },
]
