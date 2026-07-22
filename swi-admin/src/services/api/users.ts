// Diretório do painel (Colaboradores = WORKER, Admins = ADMIN) contra o backend
// Nest (GET /users, GET /users/:id). Mantém o envelope MockResponse pra que as
// telas de employees/admins não mudem de contrato na migração (mesmo padrão do
// services/api/auth.ts). Só campos de IDENTIDADE vêm do backend — vitais/tipo
// sanguíneo/exames dependem da smartband e ficam como placeholder no mapeamento
// até o hardware existir (decisão do roadmap: saúde fica mock até a smartband).
import type { MockResponse } from '@/services/mockApi/types'
import type { Employee } from '@/services/mockApi/employees'
import type { Admin } from '@/services/mockApi/admins'
import { apiFetch } from './http'

export type { Employee, Admin }

// DTO do GET /users (lista) — espelha UsersService.toSummaryDto do backend.
export type UserSummaryDto = {
  id: string
  name: string
  email: string
  role: 'WORKER' | 'ADMIN'
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  jobTitle: string
  sector: string
  birthDate: string | null // ISO
  avatar: string
  companyRole: string | null
  createdAt: string
}

// DTO do GET /users/:id (detalhe) — soma contato + empresa.
export type UserDetailDto = UserSummaryDto & {
  phone: string | null
  cpf: string | null
  company: { id: string; name: string } | null
}

// Sem campo de tipo sanguíneo no Profile do backend — placeholder até o cadastro
// clínico existir.
const BLOOD_TYPE_PLACEHOLDER = '—'

// Idade a partir do nascimento (ISO). Sem data → 0 (placeholder; o layout mostra
// "0 anos" até o Profile ser preenchido). `now` injetado pra testabilidade.
export function ageFrom(birthDateIso: string | null, now: Date): number {
  if (!birthDateIso) return 0
  const b = new Date(birthDateIso)
  if (Number.isNaN(b.getTime())) return 0
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age < 0 ? 0 : age
}

const APPROVAL_TO_STATUS = {
  APPROVED: 'accept',
  PENDING: 'pending',
  REJECTED: 'canceled',
} as const

// DTO → Employee (UI). role=jobTitle (linha 1), specialization=sector (linha 2).
// Campos de saúde omitidos (opcionais no tipo; o WorkerDetailsLayout já cai no
// fallback). bloodType e vitalsStatus são obrigatórios → placeholder neutro.
function toEmployee(u: UserSummaryDto): Employee {
  return {
    id: u.id,
    name: u.name,
    age: ageFrom(u.birthDate, new Date()),
    bloodType: BLOOD_TYPE_PLACEHOLDER,
    role: u.jobTitle,
    specialization: u.sector,
    avatarUri: u.avatar,
    sector: u.sector,
    vitalsStatus: 'good',
  }
}

// DTO → Admin (UI). active/status derivam do approvalStatus real.
function toAdmin(u: UserSummaryDto): Admin {
  return {
    id: u.id,
    name: u.name,
    age: ageFrom(u.birthDate, new Date()),
    bloodType: BLOOD_TYPE_PLACEHOLDER,
    role: u.jobTitle,
    specialization: u.sector,
    avatarUri: u.avatar,
    active: u.approvalStatus === 'APPROVED',
    status: APPROVAL_TO_STATUS[u.approvalStatus],
  }
}

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

async function listMapped<T>(
  role: 'WORKER' | 'ADMIN',
  map: (u: UserSummaryDto) => T,
): Promise<MockResponse<T[]>> {
  try {
    const users = await apiFetch<UserSummaryDto[]>(`/users?role=${role}`)
    return { data: users.map(map), error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, 'Falha ao carregar') } }
  }
}

async function getMapped<T>(
  id: string,
  map: (u: UserSummaryDto) => T,
): Promise<MockResponse<T | null>> {
  try {
    const user = await apiFetch<UserDetailDto>(`/users/${id}`)
    return { data: map(user), error: null }
  } catch (e) {
    // A tela só distingue loading × (data|null) — qualquer erro (404, rede) cai
    // na tela "não encontrado". Mantém o envelope preenchido por consistência.
    return { data: null, error: { message: errorMessage(e, 'Falha ao carregar') } }
  }
}

export const employeesApi = {
  list: () => listMapped('WORKER', toEmployee),
  get: (id: string) => getMapped(id, toEmployee),
}

export const adminsApi = {
  list: () => listMapped('ADMIN', toAdmin),
  get: (id: string) => getMapped(id, toAdmin),
}

// Fila de aprovação: WORKERs pendentes. createdAt (quando o cadastro entrou) vira
// requestedAt na UI da fila.
export type PendingUser = { id: string; name: string; email: string; requestedAt: string }
const toPending = (u: UserSummaryDto): PendingUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  requestedAt: u.createdAt,
})

// Ação de moderação: aprovar/rejeitar um cadastro. O backend responde só o novo
// estado ({id, approvalStatus}); a fila usa isso pra tirar o item da lista.
type ApprovalResult = { id: string; approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' }
const postAction = async (
  id: string,
  action: 'approve' | 'reject',
): Promise<MockResponse<ApprovalResult>> => {
  try {
    const r = await apiFetch<ApprovalResult>(`/users/${id}/${action}`, { method: 'POST' })
    return { data: r, error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, 'Falha na ação') } }
  }
}

export const approvalsApi = {
  listPendingWorkers: async (): Promise<MockResponse<PendingUser[]>> => {
    try {
      const users = await apiFetch<UserSummaryDto[]>('/users?role=WORKER&approvalStatus=PENDING')
      return { data: users.map(toPending), error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao carregar') } }
    }
  },
  approve: (id: string) => postAction(id, 'approve'),
  reject: (id: string) => postAction(id, 'reject'),
}
