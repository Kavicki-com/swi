// Diretório do painel (Colaboradores = WORKER, Admins = ADMIN) contra o backend
// Nest (GET /users, GET /users/:id). Mantém o envelope ServiceResponse pra que as
// telas de employees/admins não mudem de contrato na migração (mesmo padrão do
// services/api/auth.ts). Só campos de IDENTIDADE vêm do backend — vitais/tipo
// sanguíneo/exames dependem da smartband e ficam como placeholder no mapeamento
// até o hardware existir (decisão do roadmap: saúde fica mock até a smartband).
import type { ServiceResponse } from '@/services/types'
import type { Admin, Employee, ExamEntry, Gender } from '@/services/types/directory'
import type { Exam } from './exams'
import { examCardParts } from './examCard'
import { apiFetch } from './http'

export type { Employee, Admin }

// DTO do GET /users (lista) — espelha UsersService.toSummaryDto do backend.
export type UserSummaryDto = {
  id: string
  name: string
  email: string
  role: 'WORKER' | 'ADMIN'
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  // Flag de ativação real (independente do approvalStatus): o admin liga/desliga
  // o acesso pelo toggle sem mexer no fluxo de aprovação.
  active: boolean
  jobTitle: string
  sector: string
  // Tipo sanguíneo REAL do Profile (editável no settings) — null quando o
  // cadastro clínico ainda não foi preenchido.
  bloodType: string | null
  birthDate: string | null // ISO
  avatar: string
  companyRole: string | null
  // Handle visível (@username), fase 1 da função do campo "Nome do usuário".
  // null enquanto a conta não definiu um.
  username: string | null
  createdAt: string
}

// DTO do GET /users/:id (detalhe) — soma contato + empresa + cadastro clínico.
export type UserDetailDto = UserSummaryDto & {
  phone: string | null
  cpf: string | null
  company: { id: string; name: string } | null
  // Declaratórios do Profile (o próprio usuário edita no settings). O detalhe
  // já tinha UI pra eles mas o DTO não os trazia: "Gênero" caía no default
  // fixo do layout e "Alergias" ficava um título sem conteúdo.
  gender: string | null
  allergies: string | null
  chronicConditions: string | null
  // Histórico clínico REAL (tabela Exam). Opcional porque backend anterior ao
  // PR feat/backend-exam-filetypes não manda o campo — e a tela lendo undefined
  // mostra o vazio honesto, não uma lista inventada.
  exams?: ReadonlyArray<{ id: string; name: string; date: string; fileUrl: string }>
}

// Placeholder pra quando o Profile ainda não tem o tipo sanguíneo preenchido —
// NUNCA um default universal tipo O+.
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

// "Penicilina, Látex" → ['Penicilina', 'Látex']. Campo livre no cadastro; vira
// uma chip por item. String vazia/só espaços → undefined (o layout mostra o
// estado vazio honesto em vez de uma chip em branco).
export function parseAllergies(raw: string | null | undefined): string[] | undefined {
  const items = (raw ?? '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

// Vocabulário gravado do gênero: os três códigos que o cadastro emite
// ('male'/'female'/'other', ver dadosDeSaude no AdminsCreate). Qualquer outro
// valor, ou a ausência, vira undefined pra que a tela diga "não informado" em
// vez de inventar um gênero.
//
// 'other' NÃO pode colapsar em undefined: quem se declarou não-binário FEZ uma
// declaração, e apagá-la o torna indistinguível de quem preferiu não responder,
// que é a única distinção que o formulário se deu ao trabalho de coletar.
//
// Exportada porque o painel do chat mapeia o MESMO campo do MESMO backend
// (useChatInbox): duplicar a tradução lá foi o que fez as duas telas
// discordarem sobre a mesma pessoa.
export const toGender = (raw: string | null | undefined): Gender | undefined =>
  raw === 'male' || raw === 'female' || raw === 'other' ? raw : undefined

// Exames do DTO → entradas do ExamInfoCard. Lista vazia vira undefined porque
// o layout distingue "não tem exame" de "não veio no DTO", e undefined é o que
// o `?? []` dele espera. A quebra da data sai do examCardParts (fatia texto,
// não usa Date — a validade é data de calendário).
function toExamHistory(exams: UserDetailDto['exams']): ExamEntry[] | undefined {
  if (!exams || exams.length === 0) return undefined
  return exams.map((e) => {
    const parts = examCardParts(e.date)
    return { id: e.id, title: e.name, year: parts.year, date: parts.date, fileUrl: e.fileUrl }
  })
}

// DTO → Employee (UI). role=jobTitle (linha 1), specialization=sector (linha 2).
// Vitais ficam de fora (simulados até a smartband); o cadastro CLÍNICO
// (gênero/alergias) só existe no DTO de detalhe — na lista vem undefined.
function toEmployee(u: UserSummaryDto | UserDetailDto): Employee {
  const detail = u as Partial<UserDetailDto>
  return {
    id: u.id,
    name: u.name,
    age: ageFrom(u.birthDate, new Date()),
    bloodType: u.bloodType ?? BLOOD_TYPE_PLACEHOLDER,
    role: u.jobTitle,
    specialization: u.sector,
    avatarUri: u.avatar,
    sector: u.sector,
    vitalsStatus: 'good',
    active: u.active,
    username: u.username ?? undefined,
    gender: toGender(detail.gender),
    allergies: parseAllergies(detail.allergies),
    examHistory: toExamHistory(detail.exams),
  }
}

// DTO → Admin (UI). `active` vem do campo real de ativação (toggle liga/desliga
// o acesso); `status` continua derivando do approvalStatus (fluxo de aprovação).
function toAdmin(u: UserSummaryDto | UserDetailDto): Admin {
  const detail = u as Partial<UserDetailDto>
  return {
    id: u.id,
    name: u.name,
    age: ageFrom(u.birthDate, new Date()),
    bloodType: u.bloodType ?? BLOOD_TYPE_PLACEHOLDER,
    role: u.jobTitle,
    specialization: u.sector,
    avatarUri: u.avatar,
    active: u.active,
    status: APPROVAL_TO_STATUS[u.approvalStatus],
    username: u.username ?? undefined,
    gender: toGender(detail.gender),
    allergies: parseAllergies(detail.allergies),
    examHistory: toExamHistory(detail.exams),
  }
}

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

async function listMapped<T>(
  role: 'WORKER' | 'ADMIN',
  map: (u: UserSummaryDto) => T,
): Promise<ServiceResponse<T[]>> {
  try {
    // approvalStatus=APPROVED: sem ele um cadastro AINDA PENDENTE, ou até
    // rejeitado, entra na lista, nos KPIs e nos vitais do monitoramento. O
    // número subiria já no cadastro e aprovar não mudaria nada visível. É a
    // aprovação que promove o usuário pras listas.
    const users = await apiFetch<UserSummaryDto[]>(`/users?role=${role}&approvalStatus=APPROVED`)
    return { data: users.map(map), error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, 'Falha ao carregar') } }
  }
}

async function getMapped<T>(
  id: string,
  map: (u: UserSummaryDto) => T,
): Promise<ServiceResponse<T | null>> {
  try {
    const user = await apiFetch<UserDetailDto>(`/users/${id}`)
    return { data: map(user), error: null }
  } catch (e) {
    // A tela só distingue loading × (data|null) — qualquer erro (404, rede) cai
    // na tela "não encontrado". Mantém o envelope preenchido por consistência.
    return { data: null, error: { message: errorMessage(e, 'Falha ao carregar') } }
  }
}

// Cadastro pelo painel (POST /users). Identidade mais a saúde DECLARATÓRIA que
// o formulário coleta; o role separa funcionário (WORKER) de admin (ADMIN).
// Campos opcionais ausentes NÃO entram no corpo (JSON.stringify já descarta
// `undefined`), pra não mandar chave vazia.
export type CreateUserInput = {
  name: string
  email: string
  password: string
  phone?: string
  cpf?: string
  birthDate?: string // ISO
  // Saúde declaratória. Chega aqui JÁ no vocabulário gravado: gender em código
  // ('male'/'female'/'other') e bloodType na sigla maiúscula. Quem traduz do
  // vocabulário da tela é o dadosDeSaude do formulário de cadastro.
  username?: string
  gender?: string
  bloodType?: string
  allergies?: string
  chronicConditions?: string
}

async function createUser(
  role: 'WORKER' | 'ADMIN',
  input: CreateUserInput,
): Promise<ServiceResponse<UserSummaryDto>> {
  try {
    const created = await apiFetch<UserSummaryDto>('/users', {
      method: 'POST',
      body: JSON.stringify({ role, ...input }),
    })
    return { data: created, error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, 'Falha ao cadastrar') } }
  }
}

/**
 * Forma que a tela de EDIÇÃO carrega. Employee e Admin são formas de exibição:
 * descartam e-mail, CPF, telefone e nascimento, que são exatamente os campos
 * que um formulário precisa reeditar. Ausência vira string vazia porque é o que
 * um campo de texto controlado sabe representar; null viraria "null" na tela.
 */
export type EditableUser = {
  id: string
  name: string
  email: string
  phone: string
  cpf: string
  birthDate: string // date-only ('AAAA-MM-DD'), '' quando não informado
  gender: string // código gravado ('male'/'female'/'other'), '' quando ausente
  bloodType: string // sigla maiúscula, '' quando ausente
  allergies: string
  chronicConditions: string
  username: string
  // Exames JÁ gravados. A tela precisa mostrá-los antes de deixar anexar mais,
  // senão o admin reanexa em duplicata o laudo que já estava lá.
  exams: readonly Exam[]
}

// Datetime com fuso → data de CALENDÁRIO. Corta no 'T' em vez de passar por
// Date: a meia-noite UTC vira o dia anterior a oeste de Greenwich, que é onde
// o cliente opera, e o nascimento recuaria um dia a cada abertura do form.
const dataPura = (iso: string | null): string => (iso ? (iso.split('T')[0] ?? '') : '')

const toEditable = (u: UserDetailDto): EditableUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone ?? '',
  cpf: u.cpf ?? '',
  birthDate: dataPura(u.birthDate),
  gender: u.gender ?? '',
  bloodType: u.bloodType ?? '',
  allergies: u.allergies ?? '',
  chronicConditions: u.chronicConditions ?? '',
  username: u.username ?? '',
  // `?? []` porque backend anterior ao PR de exames não manda o campo, e a
  // seção lendo undefined quebraria em vez de mostrar o vazio honesto.
  exams: u.exams ?? [],
})

const getForEditUser = async (id: string): Promise<ServiceResponse<EditableUser | null>> => {
  try {
    return { data: toEditable(await apiFetch<UserDetailDto>(`/users/${id}`)), error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, 'Falha ao carregar') } }
  }
}

/**
 * Corpo do PATCH /users/:id. Espelha o UpdateUserDto no que a tela de edição
 * mexe. Omitir um campo significa "não mexe", nunca "apaga".
 *
 * `email` e `password` estão FORA porque o backend não os aceita aqui: e-mail é
 * identidade de login (trocar exige reconfirmação) e o PATCH não tem campo de
 * senha. A tela reflete isso em vez de mandar chave que a whitelist descarta
 * calada, que é como um formulário passa a mentir sobre o que salvou.
 */
export type UpdateUserInput = {
  name?: string
  username?: string
  phone?: string
  cpf?: string
  birthDate?: string
  gender?: string
  bloodType?: string
  allergies?: string
  chronicConditions?: string
}

const updateUser = async (
  id: string,
  patch: UpdateUserInput,
): Promise<ServiceResponse<UserSummaryDto>> => {
  try {
    const updated = await apiFetch<UserSummaryDto>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return { data: updated, error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, 'Falha ao salvar') } }
  }
}

/**
 * Anexa um exame ao cadastro de OUTRA pessoa (POST /users/:id/exams). O
 * examsApi bate em /profile/exams, que grava sempre no usuário da sessão: por
 * ali o admin só conseguia anexar laudo no próprio perfil.
 *
 * Dois passos, como no settings: o arquivo sobe direto pro bucket por URL
 * presignada (uploadImage(file, 'exams')) e aqui só viaja a key.
 */
const addUserExam = async (
  id: string,
  input: { name: string; date: string; fileKey: string },
): Promise<ServiceResponse<Exam>> => {
  try {
    const exam = await apiFetch<Exam>(`/users/${id}/exams`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return { data: exam, error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, 'Falha ao enviar o exame') } }
  }
}

// Ativar/desativar e excluir batem em /users/:id, então moram ACIMA dos dois
// diretórios: declaradas depois de employeesApi, o const cai na temporal dead
// zone e o módulo inteiro explode no import.
// Ativar/desativar um usuário (PATCH /users/:id {active}). O backend responde
// só o novo estado ({id, active}); a tela usa o envelope de erro pra reverter o
// toggle otimista se falhar. Exposta nos DOIS diretórios: a rota sempre serviu
// os dois papéis, e em funcionário ela é a remediação que o 409 do DELETE manda
// seguir ('desative-o em vez de excluir').
const setUserActive = async (
  id: string,
  active: boolean,
): Promise<ServiceResponse<{ id: string; active: boolean }>> => {
  try {
    const r = await apiFetch<{ id: string; active: boolean }>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    })
    return { data: r, error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, 'Falha na ação') } }
  }
}

// Excluir um usuário (DELETE /users/:id): 204 sem corpo (apiFetch resolve null).
// O backend recusa com 409 quando há registros vinculados ('desative-o em vez de
// excluir'), e a mensagem vaza pro toast via envelope de erro. Em funcionário
// esse 409 é o caso ESPERADO, não a exceção: quem trabalhou acumula jornada,
// tarefa e relatório.
const removeUser = async (id: string): Promise<ServiceResponse<null>> => {
  try {
    await apiFetch<null>(`/users/${id}`, { method: 'DELETE' })
    return { data: null, error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, 'Falha na ação') } }
  }
}

export const employeesApi = {
  list: () => listMapped('WORKER', toEmployee),
  get: (id: string) => getMapped(id, toEmployee),
  create: (input: CreateUserInput) => createUser('WORKER', input),
  getForEdit: getForEditUser,
  update: updateUser,
  addExam: addUserExam,
  setActive: setUserActive,
  remove: removeUser,
}

export const adminsApi = {
  list: () => listMapped('ADMIN', toAdmin),
  get: (id: string) => getMapped(id, toAdmin),
  create: (input: CreateUserInput) => createUser('ADMIN', input),
  getForEdit: getForEditUser,
  update: updateUser,
  addExam: addUserExam,
  setActive: setUserActive,
  remove: removeUser,
}

// Fila de aprovação: WORKERs pendentes. createdAt (quando o cadastro entrou) vira
// requestedAt na UI da fila.
// O perfil vem JUNTO do cadastro, porque o app coleta o wizard antes de criar
// a conta, então a fila mostra em cima de que o admin está decidindo.
// null significa que o worker não preencheu, e a tela escreve "Não informado",
// nunca um valor de fachada.
export type PendingUser = {
  id: string
  name: string
  email: string
  requestedAt: string
  cpf: string | null
  phone: string | null
  birthDate: string | null
  city: string | null
  uf: string | null
  bloodType: string | null
  allergies: string | null
  avatar: string
}
const toPending = (u: UserSummaryDto & Partial<PendingUser>): PendingUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  requestedAt: u.createdAt,
  cpf: u.cpf ?? null,
  phone: u.phone ?? null,
  birthDate: u.birthDate ?? null,
  city: u.city ?? null,
  uf: u.uf ?? null,
  bloodType: u.bloodType ?? null,
  allergies: u.allergies ?? null,
  avatar: u.avatar ?? '',
})

// Ação de moderação: aprovar/rejeitar um cadastro. O backend responde só o novo
// estado ({id, approvalStatus}); a fila usa isso pra tirar o item da lista.
type ApprovalResult = { id: string; approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' }
const postAction = async (
  id: string,
  action: 'approve' | 'reject',
): Promise<ServiceResponse<ApprovalResult>> => {
  try {
    const r = await apiFetch<ApprovalResult>(`/users/${id}/${action}`, { method: 'POST' })
    return { data: r, error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, 'Falha na ação') } }
  }
}

export const approvalsApi = {
  listPendingWorkers: async (): Promise<ServiceResponse<PendingUser[]>> => {
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
