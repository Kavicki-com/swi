// src/services/mockApi/roster.ts
// Canonical worker roster — single source of truth for the demo. Both the
// /employees list (mockApi/employees.ts, UI-shaped) and the Dashboard map
// markers + alerts (mockApi/seed.ts, API-shaped) derive their entries from
// this array via the adapters below. Same `id` and `name` everywhere so
// clicking a pin in /dashboard, an alert in /alerts, or a row in /employees
// always lands on the same /employees/:id profile.
import workerA from '@/assets/avatars/worker-a.png'
import workerB from '@/assets/avatars/worker-b.png'
import workerC from '@/assets/avatars/worker-c.png'

export type ExamEntry = {
  id: string
  year: string
  date: string
  title: string
}

export type WorkerProfile = {
  // Identity
  id: string
  name: string
  cpf: string
  age: number
  gender: 'male' | 'female'
  bloodType: string
  allergies: ReadonlyArray<string>
  // Employment
  role: string
  specialization: string
  sector: string
  avatarUri: string
  // Vitals (UI 3-state, mapped to the API 4-state by `isOnline` below)
  vitalsStatus: 'good' | 'warning' | 'critical'
  bpm: number
  pressure: string
  fatigueRate: number
  effort: number
  fatigueMinutes: number
  statusLabel: string
  // Connectivity + position
  isOnline: boolean
  location: { lat: number; lng: number } | null
  lastSeenMinutesAgo: number
  createdDaysAgo: number
  // Misc
  hasUnreadMessages?: boolean
  examHistory: ReadonlyArray<ExamEntry>
}

// Shared exam history fixture — Figma 54:6561 shows the same 7-entry list
// for every worker in the demo, so any profile opens fully populated.
const SHARED_EXAM_HISTORY: ReadonlyArray<ExamEntry> = [
  { id: 'exam-01', year: '2027', date: '05 Mar', title: 'Exame de reciclagem técnica' },
  { id: 'exam-02', year: '2029', date: '19 Nov', title: 'Avaliação de segurança' },
  { id: 'exam-03', year: '2031', date: '14 Jul', title: 'Certificação em normas ISO' },
  { id: 'exam-04', year: '2033', date: '28 Fev', title: 'Exame de aptidão física e mental' },
  { id: 'exam-05', year: '2035', date: '12 Set', title: 'Treinamento NR-22 atualização' },
  { id: 'exam-06', year: '2037', date: '03 Jun', title: 'Avaliação psicológica anual' },
  { id: 'exam-07', year: '2039', date: '21 Out', title: 'Audiometria ocupacional' },
]

// Default vitals snapshot — Figma reference values. Workers with vitalsStatus
// 'warning' or 'critical' override these inline below.
const VITALS_BASE = {
  bpm: 99,
  pressure: '12/8',
  fatigueRate: 0.625,
  effort: 0.692,
  fatigueMinutes: 167,
  statusLabel: 'Condições excelentes',
} as const

// Location grid — São Paulo Bela Vista (Figma reference). Spread across
// sectors so the dashboard map shows real geographic dispersion.
const LOC = {
  leste1: { lat: -23.55, lng: -46.63 },
  leste2: { lat: -23.55, lng: -46.62 },
  norte1: { lat: -23.55, lng: -46.64 },
  norte2: { lat: -23.54, lng: -46.65 },
  sul1: { lat: -23.56, lng: -46.62 },
  sul2: { lat: -23.57, lng: -46.61 },
  oeste1: { lat: -23.55, lng: -46.66 },
  oeste2: { lat: -23.58, lng: -46.6 },
  oeste3: { lat: -23.54, lng: -46.62 },
} as const

export const ROSTER: ReadonlyArray<WorkerProfile> = [
  {
    id: 'emp-01',
    name: 'Larissa Sales',
    cpf: '111.111.111-11',
    age: 28,
    gender: 'female',
    bloodType: 'A+',
    allergies: ['Buscopan', 'Dipirona', 'Chocolate', 'Camarão'],
    role: 'Engenheira de Produção',
    specialization: 'Coordenadora de Turno',
    sector: 'Setor Leste',
    avatarUri: workerA,
    vitalsStatus: 'good',
    ...VITALS_BASE,
    isOnline: true,
    location: LOC.leste1,
    lastSeenMinutesAgo: 2,
    createdDaysAgo: 30,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-02',
    name: 'Ana Paula Gomes',
    cpf: '222.222.222-22',
    age: 34,
    gender: 'female',
    bloodType: 'O+',
    allergies: ['Buscopan', 'Dipirona', 'Chocolate', 'Camarão'],
    role: 'Engenheira de Segurança',
    specialization: 'Especialista em Riscos',
    sector: 'Setor Norte',
    avatarUri: workerB,
    vitalsStatus: 'warning',
    bpm: 112,
    pressure: '14/9',
    fatigueRate: 0.74,
    effort: 0.81,
    fatigueMinutes: 188,
    statusLabel: 'Frequência elevada',
    isOnline: true,
    location: LOC.norte1,
    lastSeenMinutesAgo: 1,
    createdDaysAgo: 45,
    hasUnreadMessages: true,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-03',
    name: 'Lúcia Fernandes',
    cpf: '333.333.333-33',
    age: 42,
    gender: 'female',
    bloodType: 'B-',
    allergies: ['Buscopan', 'Dipirona', 'Chocolate', 'Camarão'],
    role: 'Eletricista',
    specialization: 'Manutenção Elétrica',
    sector: 'Setor Sul',
    avatarUri: workerC,
    vitalsStatus: 'good',
    ...VITALS_BASE,
    isOnline: true,
    location: LOC.sul1,
    lastSeenMinutesAgo: 3,
    createdDaysAgo: 20,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-04',
    name: 'Carlos Henrique Silva',
    cpf: '444.444.444-44',
    age: 31,
    gender: 'male',
    bloodType: 'AB+',
    allergies: ['Buscopan', 'Dipirona', 'Chocolate', 'Camarão'],
    role: 'Geólogo',
    specialization: 'Supervisor de Mina',
    sector: 'Setor Oeste',
    avatarUri: workerA,
    vitalsStatus: 'critical',
    bpm: 138,
    pressure: '16/10',
    fatigueRate: 0.91,
    effort: 0.94,
    fatigueMinutes: 218,
    statusLabel: 'Possível queda detectada',
    isOnline: true,
    location: LOC.oeste1,
    lastSeenMinutesAgo: 5,
    createdDaysAgo: 15,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-05',
    name: 'Mariana de Souza',
    cpf: '555.555.555-55',
    age: 29,
    gender: 'female',
    bloodType: 'O-',
    allergies: ['Lactose'],
    role: 'Analista Ambiental',
    specialization: 'Gestora de Projetos',
    sector: 'Setor Leste',
    avatarUri: workerB,
    vitalsStatus: 'good',
    ...VITALS_BASE,
    isOnline: true,
    location: LOC.leste2,
    lastSeenMinutesAgo: 6,
    createdDaysAgo: 8,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-06',
    name: 'Pedro Martins Lima',
    cpf: '666.666.666-66',
    age: 37,
    gender: 'male',
    bloodType: 'A-',
    allergies: [],
    role: 'Técnico em Segurança do Trabalho',
    specialization: 'Instrutor',
    sector: 'Setor Norte',
    avatarUri: workerC,
    vitalsStatus: 'warning',
    bpm: 108,
    pressure: '13/9',
    fatigueRate: 0.68,
    effort: 0.77,
    fatigueMinutes: 174,
    statusLabel: 'Tensão arterial elevada',
    isOnline: true,
    location: LOC.norte2,
    lastSeenMinutesAgo: 4,
    createdDaysAgo: 50,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-07',
    name: 'Amanda Costa Pereira',
    cpf: '777.777.777-77',
    age: 26,
    gender: 'female',
    bloodType: 'B+',
    allergies: [],
    role: 'Técnica em Laboratório',
    specialization: 'Controle de Qualidade',
    sector: 'Setor Sul',
    avatarUri: workerA,
    vitalsStatus: 'good',
    ...VITALS_BASE,
    isOnline: true,
    location: LOC.sul2,
    lastSeenMinutesAgo: 4,
    createdDaysAgo: 12,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-08',
    name: 'Rafael Oliveira',
    cpf: '888.888.888-88',
    age: 45,
    gender: 'male',
    bloodType: 'O+',
    allergies: ['Penicilina'],
    role: 'Operador de Escavadeira',
    specialization: 'Mineração K22',
    sector: 'Setor Oeste',
    avatarUri: workerB,
    vitalsStatus: 'good',
    ...VITALS_BASE,
    isOnline: true,
    location: LOC.oeste2,
    lastSeenMinutesAgo: 8,
    createdDaysAgo: 70,
    hasUnreadMessages: true,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-09',
    name: 'Juliana Costa',
    cpf: '999.999.999-99',
    age: 33,
    gender: 'female',
    bloodType: 'AB-',
    allergies: [],
    role: 'Geofísica',
    specialization: 'Análise Sísmica',
    sector: 'Setor Leste',
    avatarUri: workerC,
    vitalsStatus: 'good',
    ...VITALS_BASE,
    isOnline: true,
    location: LOC.oeste3,
    lastSeenMinutesAgo: 6,
    createdDaysAgo: 18,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-10',
    name: 'Marcos Vinícius',
    cpf: '101.010.101-01',
    age: 27,
    gender: 'male',
    bloodType: 'A+',
    allergies: ['Frutos do mar'],
    role: 'Motorista de Caminhão',
    specialization: 'Transporte de Carga',
    sector: 'Setor Norte',
    avatarUri: workerA,
    vitalsStatus: 'critical',
    bpm: 142,
    pressure: '17/11',
    fatigueRate: 0.88,
    effort: 0.96,
    fatigueMinutes: 224,
    statusLabel: 'Sinais críticos',
    isOnline: true,
    location: LOC.norte1,
    lastSeenMinutesAgo: 8,
    createdDaysAgo: 5,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-11',
    name: 'Henrique Tavares',
    cpf: '888.111.222-33',
    age: 39,
    gender: 'male',
    bloodType: 'B-',
    allergies: [],
    role: 'Soldador',
    specialization: 'Soldagem Especial',
    sector: 'Setor Oeste',
    avatarUri: workerB,
    vitalsStatus: 'good',
    ...VITALS_BASE,
    isOnline: false,
    location: null,
    lastSeenMinutesAgo: 240,
    createdDaysAgo: 60,
    examHistory: SHARED_EXAM_HISTORY,
  },
  {
    id: 'emp-12',
    name: 'Karen Oliveira',
    cpf: '121.212.121-12',
    age: 31,
    gender: 'female',
    bloodType: 'O+',
    allergies: [],
    role: 'Operadora de Britador',
    specialization: 'Processamento Mineral',
    sector: 'Setor Sul',
    avatarUri: workerC,
    vitalsStatus: 'good',
    ...VITALS_BASE,
    isOnline: true,
    location: LOC.sul1,
    lastSeenMinutesAgo: 2,
    createdDaysAgo: 25,
    examHistory: SHARED_EXAM_HISTORY,
  },
]
