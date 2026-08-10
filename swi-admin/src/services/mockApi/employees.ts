// src/services/mockApi/employees.ts
// /employees list API — UI-shaped Employee records derived from the canonical
// ROSTER (see roster.ts). The visible roster shares
// IDs and names with the dashboard map markers and alerts so cross-page
// navigation (pin → details, alert → details) resolves to the same person.
import { sleep } from './sleep'
import type { MockResponse } from './types'
import { ROSTER, type WorkerProfile, type ExamEntry } from './roster'

export type EmployeeExamEntry = ExamEntry

// Employee mora em services/types/directory, o contrato de view que o backend
// real também produz; o re-export mantém os imports locais resolvendo.
import type { Employee } from '@/services/types/directory'

export type { Employee }

// Adapter: roster Person → Employee (UI shape). Drops connectivity/location
// (the /employees list doesn't render a map column) and serialises the
// vitals snapshot already attached to the roster entry.
function toEmployeeUi(p: WorkerProfile): Employee {
  return {
    id: p.id,
    name: p.name,
    age: p.age,
    bloodType: p.bloodType,
    role: p.role,
    specialization: p.specialization,
    avatarUri: p.avatarUri,
    sector: p.sector,
    vitalsStatus: p.vitalsStatus,
    hasUnreadMessages: p.hasUnreadMessages,
    gender: p.gender,
    bpm: p.bpm,
    pressure: p.pressure,
    fatigueRate: p.fatigueRate,
    effort: p.effort,
    fatigueMinutes: p.fatigueMinutes,
    statusLabel: p.statusLabel,
    allergies: p.allergies.length > 0 ? p.allergies : undefined,
    examHistory: p.examHistory,
  }
}

const EMPLOYEES_SEED: ReadonlyArray<Employee> = ROSTER.map(toEmployeeUi)

// Total registered ("1205" per spec), separated from the visible seed so the
// page header reads the same as the mock without depending on the list size.
export const EMPLOYEES_TOTAL = 1205

export const employeesApi = {
  async list(): Promise<MockResponse<Employee[]>> {
    await sleep(120)
    return { data: [...EMPLOYEES_SEED], error: null }
  },
  async get(id: string): Promise<MockResponse<Employee | null>> {
    await sleep(80)
    const e = EMPLOYEES_SEED.find((x) => x.id === id) ?? null
    return { data: e, error: null }
  },
}
