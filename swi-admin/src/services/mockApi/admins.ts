import { sleep } from './sleep'
import type { MockResponse } from './types'
import adminElisa from '@/assets/avatars/admin-elisa.png'
import adminMathias from '@/assets/avatars/admin-mathias.svg'
import adminJoao from '@/assets/avatars/admin-joao.svg'

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
    gender: 'male',
    bpm: 87,
    pressure: '13/9',
    fatigueRate: 0.418,
    effort: 0.812,
    status: 'accept',
    statusLabel: 'Condições estáveis',
    fatigueMinutes: 94,
    allergies: ['Penicilina', 'Amoxicilina', 'Pó de quartzo'],
    examHistory: [
      {
        id: 'exam-02-01',
        year: '2026',
        date: '11 Jan',
        title: 'Curso NR-22 atualização anual',
        subtitle: '',
      },
      {
        id: 'exam-02-02',
        year: '2028',
        date: '07 Mai',
        title: 'Exame de aptidão para altura',
        subtitle: '',
      },
      {
        id: 'exam-02-03',
        year: '2030',
        date: '23 Ago',
        title: 'Avaliação ergonômica',
        subtitle: '',
      },
      {
        id: 'exam-02-04',
        year: '2032',
        date: '15 Dez',
        title: 'Reciclagem em primeiros socorros',
        subtitle: '',
      },
      {
        id: 'exam-02-05',
        year: '2034',
        date: '02 Abr',
        title: 'Auditoria interna de segurança',
        subtitle: '',
      },
    ],
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
    gender: 'male',
    bpm: 102,
    pressure: '14/9',
    fatigueRate: 0.781,
    effort: 0.547,
    status: 'pending',
    statusLabel: 'Alerta de fadiga',
    fatigueMinutes: 198,
    allergies: ['Látex', 'Amendoim', 'Frutos do mar'],
    examHistory: [
      {
        id: 'exam-03-01',
        year: '2027',
        date: '18 Fev',
        title: 'Inspeção técnica de equipamentos',
        subtitle: '',
      },
      {
        id: 'exam-03-02',
        year: '2029',
        date: '04 Jul',
        title: 'Avaliação psicossocial',
        subtitle: '',
      },
      {
        id: 'exam-03-03',
        year: '2031',
        date: '27 Set',
        title: 'Exame de função pulmonar',
        subtitle: '',
      },
      {
        id: 'exam-03-04',
        year: '2033',
        date: '09 Mar',
        title: 'Treinamento em desmonte de rochas',
        subtitle: '',
      },
      {
        id: 'exam-03-05',
        year: '2035',
        date: '14 Nov',
        title: 'Certificação em gestão de riscos',
        subtitle: '',
      },
      {
        id: 'exam-03-06',
        year: '2037',
        date: '30 Jun',
        title: 'Avaliação cardiológica anual',
        subtitle: '',
      },
    ],
  },
  {
    id: 'admin-04',
    name: 'Renata Vasconcelos',
    age: 41,
    bloodType: 'B+',
    role: 'Diretora de Operações',
    specialization: 'Engenharia de Produção',
    avatarUri: adminElisa,
    active: true,
    gender: 'female',
    bpm: 76,
    pressure: '12/8',
    fatigueRate: 0.342,
    effort: 0.624,
    status: 'accept',
    statusLabel: 'Condições excelentes',
    fatigueMinutes: 72,
    allergies: ['Frutos do mar'],
    examHistory: [
      {
        id: 'exam-04-01',
        year: '2026',
        date: '08 Fev',
        title: 'Auditoria operacional anual',
        subtitle: '',
      },
      {
        id: 'exam-04-02',
        year: '2028',
        date: '17 Jun',
        title: 'Treinamento em gestão de crise',
        subtitle: '',
      },
      {
        id: 'exam-04-03',
        year: '2030',
        date: '22 Nov',
        title: 'Certificação ISO 45001',
        subtitle: '',
      },
      {
        id: 'exam-04-04',
        year: '2032',
        date: '05 Ago',
        title: 'Avaliação cardiológica',
        subtitle: '',
      },
      {
        id: 'exam-04-05',
        year: '2034',
        date: '19 Mar',
        title: 'Curso de liderança avançada',
        subtitle: '',
      },
    ],
  },
  {
    id: 'admin-05',
    name: 'Eduardo Lopes Pereira',
    age: 38,
    bloodType: 'O-',
    role: 'Engenheiro Mecânico',
    specialization: 'Manutenção Pesada',
    avatarUri: adminMathias,
    active: true,
    gender: 'male',
    bpm: 92,
    pressure: '13/8',
    fatigueRate: 0.512,
    effort: 0.708,
    status: 'accept',
    statusLabel: 'Condições estáveis',
    fatigueMinutes: 121,
    allergies: ['Pólen'],
    examHistory: [
      {
        id: 'exam-05-01',
        year: '2027',
        date: '12 Jan',
        title: 'Inspeção de equipamentos críticos',
        subtitle: '',
      },
      {
        id: 'exam-05-02',
        year: '2029',
        date: '04 Mai',
        title: 'Curso NR-12 atualização',
        subtitle: '',
      },
      {
        id: 'exam-05-03',
        year: '2031',
        date: '26 Set',
        title: 'Avaliação ergonômica',
        subtitle: '',
      },
      {
        id: 'exam-05-04',
        year: '2033',
        date: '11 Dez',
        title: 'Reciclagem em soldagem',
        subtitle: '',
      },
      {
        id: 'exam-05-05',
        year: '2035',
        date: '03 Jul',
        title: 'Análise vibracional avançada',
        subtitle: '',
      },
      {
        id: 'exam-05-06',
        year: '2037',
        date: '18 Out',
        title: 'Avaliação cardiológica anual',
        subtitle: '',
      },
    ],
  },
  {
    id: 'admin-06',
    name: 'Patrícia Almeida',
    age: 45,
    bloodType: 'AB+',
    role: 'Médica do Trabalho',
    specialization: 'Saúde Ocupacional',
    avatarUri: adminElisa,
    active: true,
    gender: 'female',
    bpm: 68,
    pressure: '11/7',
    fatigueRate: 0.218,
    effort: 0.485,
    status: 'accept',
    statusLabel: 'Condições excelentes',
    fatigueMinutes: 48,
    allergies: ['Iodo', 'Sulfas'],
    examHistory: [
      {
        id: 'exam-06-01',
        year: '2026',
        date: '20 Mar',
        title: 'Atualização CRM ocupacional',
        subtitle: '',
      },
      { id: 'exam-06-02', year: '2028', date: '14 Jul', title: 'Curso ASO PCMSO', subtitle: '' },
      {
        id: 'exam-06-03',
        year: '2030',
        date: '09 Out',
        title: 'Workshop ergonomia mineração',
        subtitle: '',
      },
      {
        id: 'exam-06-04',
        year: '2032',
        date: '02 Mai',
        title: 'Avaliação psicológica',
        subtitle: '',
      },
      { id: 'exam-06-05', year: '2034', date: '24 Jan', title: 'Certificação NR-7', subtitle: '' },
    ],
  },
  {
    id: 'admin-07',
    name: 'Fernando Carvalho',
    age: 36,
    bloodType: 'A+',
    role: 'Coordenador de SST',
    specialization: 'Segurança e Saúde',
    avatarUri: adminJoao,
    active: false,
    gender: 'male',
    bpm: 84,
    pressure: '12/8',
    fatigueRate: 0.456,
    effort: 0.612,
    status: 'pending',
    statusLabel: 'Condições estáveis',
    fatigueMinutes: 108,
    allergies: [],
    examHistory: [
      {
        id: 'exam-07-01',
        year: '2027',
        date: '07 Abr',
        title: 'Auditoria DDS mensal',
        subtitle: '',
      },
      {
        id: 'exam-07-02',
        year: '2029',
        date: '21 Set',
        title: 'Treinamento brigada de incêndio',
        subtitle: '',
      },
      {
        id: 'exam-07-03',
        year: '2031',
        date: '14 Fev',
        title: 'Curso CIPA presencial',
        subtitle: '',
      },
      {
        id: 'exam-07-04',
        year: '2033',
        date: '28 Jun',
        title: 'Reciclagem em primeiros socorros',
        subtitle: '',
      },
    ],
  },
  {
    id: 'admin-08',
    name: 'Beatriz Marques',
    age: 33,
    bloodType: 'O+',
    role: 'Engenheira Ambiental',
    specialization: 'Licenciamento e Compliance',
    avatarUri: adminElisa,
    active: true,
    gender: 'female',
    bpm: 81,
    pressure: '12/8',
    fatigueRate: 0.387,
    effort: 0.694,
    status: 'accept',
    statusLabel: 'Condições excelentes',
    fatigueMinutes: 88,
    allergies: ['Látex'],
    examHistory: [
      {
        id: 'exam-08-01',
        year: '2027',
        date: '03 Jan',
        title: 'Auditoria ambiental anual',
        subtitle: '',
      },
      { id: 'exam-08-02', year: '2029', date: '11 Abr', title: 'Curso ISO 14001', subtitle: '' },
      {
        id: 'exam-08-03',
        year: '2031',
        date: '25 Ago',
        title: 'Inspeção de monitoramento de águas',
        subtitle: '',
      },
      {
        id: 'exam-08-04',
        year: '2033',
        date: '06 Nov',
        title: 'Treinamento APP/Reserva Legal',
        subtitle: '',
      },
      {
        id: 'exam-08-05',
        year: '2035',
        date: '17 Mai',
        title: 'Avaliação cardiológica anual',
        subtitle: '',
      },
    ],
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
