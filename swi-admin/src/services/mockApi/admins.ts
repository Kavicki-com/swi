import { sleep } from './sleep'
import type { MockResponse } from './types'
import adminElisa from '@/assets/avatars/admin-elisa.png'
import adminMathias from '@/assets/avatars/admin-mathias.png'
import adminJoao from '@/assets/avatars/admin-joao.png'

export type ExamEntry = {
  id: string
  year: string
  date: string
  title: string
  subtitle: string
}

export type Admin = {
  id: string
  name: string
  age: number
  bloodType: string
  role: string
  specialization: string
  avatarUri: string
  active: boolean
  // Health fields used by the AdminDetails screen (Figma 53:6344).
  gender?: 'male' | 'female'
  height?: string
  weight?: string
  imc?: string
  bpm?: number
  pressure?: string
  fatigueRate?: number
  effort?: number
  status?: 'accept' | 'pending' | 'canceled'
  statusLabel?: string
  fatigueMinutes?: number
  allergies?: ReadonlyArray<string>
  examHistory?: ReadonlyArray<ExamEntry>
}

// Mock data matches Figma 48:4943/4972/5001 verbatim — names, ages, roles
// and active state were extracted directly from the design so the screen
// reads like the spec. Avatars are local PNGs cropped from the Figma cards.
const ADMINS_SEED: ReadonlyArray<Admin> = [
  {
    id: 'admin-01',
    name: 'Elisa Siqueira Jordão',
    age: 26,
    bloodType: 'O+',
    role: 'Administradora de Sistema',
    specialization: 'Engenheira Civil',
    avatarUri: adminElisa,
    active: true,
    gender: 'female',
    bpm: 99,
    pressure: '12/8',
    fatigueRate: 0.625,
    effort: 0.692,
    status: 'accept',
    statusLabel: 'Condições excelentes',
    fatigueMinutes: 167,
    allergies: ['Buscopan', 'Dipirona', 'Chocolate', 'Camarão'],
    examHistory: [
      {
        id: 'exam-01',
        year: '2027',
        date: '05 Mar',
        title: 'Exame de reciclagem técnica',
        subtitle: '',
      },
      {
        id: 'exam-02',
        year: '2029',
        date: '19 Nov',
        title: 'Avaliação de segurança',
        subtitle: '',
      },
      {
        id: 'exam-03',
        year: '2031',
        date: '14 Jul',
        title: 'Certificação em normas ISO',
        subtitle: '',
      },
      {
        id: 'exam-04',
        year: '2033',
        date: '28 Fev',
        title: 'Exame de aptidão física e mental',
        subtitle: '',
      },
      {
        id: 'exam-05',
        year: '2035',
        date: '12 Set',
        title: 'Treinamento NR-22 atualização',
        subtitle: '',
      },
      {
        id: 'exam-06',
        year: '2037',
        date: '03 Jun',
        title: 'Avaliação psicológica anual',
        subtitle: '',
      },
      {
        id: 'exam-07',
        year: '2039',
        date: '21 Out',
        title: 'Audiometria ocupacional',
        subtitle: '',
      },
    ],
  },
  {
    id: 'admin-02',
    name: 'Mathias Campos S.',
    age: 32,
    bloodType: 'AB-',
    role: 'Segurança do trabalho',
    specialization: 'Técnico',
    avatarUri: adminMathias,
    active: true,
  },
  {
    id: 'admin-03',
    name: 'João Soares Ribeiro',
    age: 32,
    bloodType: 'A+',
    role: 'Gestor de minas',
    specialization: 'Engenharia de Mineração',
    avatarUri: adminJoao,
    active: true,
  },
]

export const adminsApi = {
  async list(): Promise<MockResponse<ReadonlyArray<Admin>>> {
    await sleep(120)
    return { data: ADMINS_SEED, error: null }
  },
  async get(id: string): Promise<MockResponse<Admin | null>> {
    await sleep(80)
    const found = ADMINS_SEED.find((a) => a.id === id) ?? null
    return { data: found, error: null }
  },
}
