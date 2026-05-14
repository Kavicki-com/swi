// src/services/mockApi/employees.ts
// Mock employees fixture for the /employees list. Names + roles taken from
// Figma 53:5786 mock data. 10 entries populate the list while keeping the
// "1205 funcionários cadastrados" total in the page header (a separate
// computed value that doesn't have to match the array length).
import { sleep } from './sleep'
import type { MockResponse } from './types'
import workerA from '@/assets/avatars/worker-a.png'
import workerB from '@/assets/avatars/worker-b.png'
import workerC from '@/assets/avatars/worker-c.png'

export type EmployeeExamEntry = {
  id: string
  year: string
  date: string
  title: string
}

export type Employee = {
  id: string
  name: string
  age: number
  bloodType: string
  role: string
  specialization: string
  avatarUri: string
  sector: string
  vitalsStatus: 'good' | 'warning' | 'critical'
  hasUnreadMessages?: boolean
  // Health/details fields used by EmployeeDetails (Figma 54:6561) — mirror
  // the Admin shape so the screen can be a near-copy of AdminDetails.
  gender?: 'male' | 'female'
  bpm?: number
  pressure?: string
  fatigueRate?: number
  effort?: number
  fatigueMinutes?: number
  statusLabel?: string
  allergies?: ReadonlyArray<string>
  examHistory?: ReadonlyArray<EmployeeExamEntry>
}

// Figma 54:6561 reference data block — same vitals/allergies/exams snapshot
// shown for every employee in the demo, so any row in the list opens a
// fully-populated details screen.
const DETAILS_FIXTURE = {
  bpm: 99,
  pressure: '12/8',
  fatigueRate: 0.625,
  effort: 0.692,
  fatigueMinutes: 167,
  statusLabel: 'Condições excelentes',
  allergies: ['Buscopan', 'Dipirona', 'Chocolate', 'Camarão'] as const,
  examHistory: [
    { id: 'exam-01', year: '2027', date: '05 Mar', title: 'Exame de reciclagem técnica' },
    { id: 'exam-02', year: '2029', date: '19 Nov', title: 'Avaliação de segurança' },
    { id: 'exam-03', year: '2031', date: '14 Jul', title: 'Certificação em normas ISO' },
    { id: 'exam-04', year: '2033', date: '28 Fev', title: 'Exame de aptidão física e mental' },
    { id: 'exam-05', year: '2035', date: '12 Set', title: 'Treinamento NR-22 atualização' },
    { id: 'exam-06', year: '2037', date: '03 Jun', title: 'Avaliação psicológica anual' },
    { id: 'exam-07', year: '2039', date: '21 Out', title: 'Audiometria ocupacional' },
  ] as const,
} as const

const EMPLOYEES_SEED: ReadonlyArray<Employee> = [
  {
    id: 'emp-01',
    name: 'Larissa Sales',
    age: 28,
    bloodType: 'A+',
    role: 'Engenheira de Produção',
    specialization: 'Coordenadora de Turno',
    avatarUri: workerA,
    sector: 'Setor Leste',
    vitalsStatus: 'good',
    gender: 'female',
    ...DETAILS_FIXTURE,
  },
  {
    id: 'emp-02',
    name: 'Ana Paula Gomes',
    age: 34,
    bloodType: 'O+',
    role: 'Engenheira de Segurança',
    specialization: 'Especialista em Riscos',
    avatarUri: workerB,
    sector: 'Setor Norte',
    vitalsStatus: 'warning',
    hasUnreadMessages: true,
    gender: 'female',
    ...DETAILS_FIXTURE,
  },
  {
    id: 'emp-03',
    name: 'Lúcia Fernandes',
    age: 42,
    bloodType: 'B-',
    role: 'Eletricista',
    specialization: 'Manutenção Elétrica',
    avatarUri: workerC,
    sector: 'Setor Sul',
    vitalsStatus: 'good',
    gender: 'female',
    ...DETAILS_FIXTURE,
  },
  {
    id: 'emp-04',
    name: 'Carlos Henrique Silva',
    age: 31,
    bloodType: 'AB+',
    role: 'Geólogo',
    specialization: 'Supervisor de Mina',
    avatarUri: workerA,
    sector: 'Setor Oeste',
    vitalsStatus: 'critical',
    gender: 'male',
    ...DETAILS_FIXTURE,
  },
  {
    id: 'emp-05',
    name: 'Mariana de Souza',
    age: 29,
    bloodType: 'O-',
    role: 'Analista Ambiental',
    specialization: 'Gestora de Projetos',
    avatarUri: workerB,
    sector: 'Setor Leste',
    vitalsStatus: 'good',
    gender: 'female',
    ...DETAILS_FIXTURE,
  },
  {
    id: 'emp-06',
    name: 'Pedro Martins Lima',
    age: 37,
    bloodType: 'A-',
    role: 'Técnico em Segurança do Trabalho',
    specialization: 'Instrutor',
    avatarUri: workerC,
    sector: 'Setor Norte',
    vitalsStatus: 'warning',
    gender: 'male',
    ...DETAILS_FIXTURE,
  },
  {
    id: 'emp-07',
    name: 'Amanda Costa Pereira',
    age: 26,
    bloodType: 'B+',
    role: 'Técnica em Laboratório',
    specialization: 'Controle de Qualidade',
    avatarUri: workerA,
    sector: 'Setor Sul',
    vitalsStatus: 'good',
    gender: 'female',
    ...DETAILS_FIXTURE,
  },
  {
    id: 'emp-08',
    name: 'Rafael Oliveira',
    age: 45,
    bloodType: 'O+',
    role: 'Operador de Escavadeira',
    specialization: 'Mineração K22',
    avatarUri: workerB,
    sector: 'Setor Oeste',
    vitalsStatus: 'good',
    hasUnreadMessages: true,
    gender: 'male',
    ...DETAILS_FIXTURE,
  },
  {
    id: 'emp-09',
    name: 'Juliana Costa',
    age: 33,
    bloodType: 'AB-',
    role: 'Geofísica',
    specialization: 'Análise Sísmica',
    avatarUri: workerC,
    sector: 'Setor Leste',
    vitalsStatus: 'good',
    gender: 'female',
    ...DETAILS_FIXTURE,
  },
  {
    id: 'emp-10',
    name: 'Marcos Vinícius',
    age: 27,
    bloodType: 'A+',
    role: 'Motorista de Caminhão',
    specialization: 'Transporte de Carga',
    avatarUri: workerA,
    sector: 'Setor Norte',
    vitalsStatus: 'critical',
    gender: 'male',
    ...DETAILS_FIXTURE,
  },
]

// Total registered (Figma "1205") — separated from the visible seed so the
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
