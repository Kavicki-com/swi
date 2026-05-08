import type { User, Employee, Alert, ISODateString } from '../types'

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
  bpm: 78,
  pressure: '12/8',
  avatarUri: 'https://i.pravatar.cc/200?img=12',
}

export const SEED_EMPLOYEES: Employee[] = [
  { id: 'e_001', org_id: SEED_ORG_ID, full_name: 'Ana Souza', cpf: '111.111.111-11', blood_type: 'O+', allergies: null, status: 'good', last_location: { lat: -23.55, lng: -46.63, updated_at: minutesAgo(2) }, created_at: daysAgo(30) },
  { id: 'e_002', org_id: SEED_ORG_ID, full_name: 'Bruno Lima', cpf: '222.222.222-22', blood_type: 'A+', allergies: 'Penicilina', status: 'good', last_location: { lat: -23.55, lng: -46.64, updated_at: minutesAgo(1) }, created_at: daysAgo(45) },
  { id: 'e_003', org_id: SEED_ORG_ID, full_name: 'Carla Pinto', cpf: '333.333.333-33', blood_type: 'B+', allergies: null, status: 'alert', last_location: { lat: -23.56, lng: -46.62, updated_at: minutesAgo(3) }, created_at: daysAgo(20) },
  { id: 'e_004', org_id: SEED_ORG_ID, full_name: 'Diego Alves', cpf: '444.444.444-44', blood_type: 'AB-', allergies: null, status: 'good', last_location: { lat: -23.54, lng: -46.65, updated_at: minutesAgo(5) }, created_at: daysAgo(15) },
  { id: 'e_005', org_id: SEED_ORG_ID, full_name: 'Eduarda Reis', cpf: '555.555.555-55', blood_type: 'O-', allergies: 'Lactose', status: 'low', last_location: { lat: -23.57, lng: -46.61, updated_at: minutesAgo(10) }, created_at: daysAgo(8) },
  { id: 'e_006', org_id: SEED_ORG_ID, full_name: 'Felipe Costa', cpf: '666.666.666-66', blood_type: 'A-', allergies: null, status: 'good', last_location: { lat: -23.55, lng: -46.66, updated_at: minutesAgo(1) }, created_at: daysAgo(50) },
  { id: 'e_007', org_id: SEED_ORG_ID, full_name: 'Gabriela Nunes', cpf: '777.777.777-77', blood_type: 'O+', allergies: null, status: 'good', last_location: { lat: -23.54, lng: -46.62, updated_at: minutesAgo(4) }, created_at: daysAgo(12) },
  { id: 'e_008', org_id: SEED_ORG_ID, full_name: 'Henrique Tavares', cpf: '888.888.888-88', blood_type: 'B-', allergies: null, status: 'offline', last_location: null, created_at: daysAgo(70) },
  { id: 'e_009', org_id: SEED_ORG_ID, full_name: 'Isabela Martins', cpf: '999.999.999-99', blood_type: 'A+', allergies: null, status: 'good', last_location: { lat: -23.55, lng: -46.62, updated_at: minutesAgo(6) }, created_at: daysAgo(18) },
  { id: 'e_010', org_id: SEED_ORG_ID, full_name: 'Joao Vinicius', cpf: '101.010.101-01', blood_type: 'AB+', allergies: 'Frutos do mar', status: 'alert', last_location: { lat: -23.58, lng: -46.60, updated_at: minutesAgo(8) }, created_at: daysAgo(5) },
  { id: 'e_011', org_id: SEED_ORG_ID, full_name: 'Karen Oliveira', cpf: '121.212.121-12', blood_type: 'O+', allergies: null, status: 'good', last_location: { lat: -23.54, lng: -46.63, updated_at: minutesAgo(2) }, created_at: daysAgo(25) },
  { id: 'e_012', org_id: SEED_ORG_ID, full_name: 'Lucas Pires', cpf: '131.313.131-13', blood_type: 'A+', allergies: null, status: 'good', last_location: { lat: -23.56, lng: -46.64, updated_at: minutesAgo(3) }, created_at: daysAgo(40) },
]

export const SEED_ALERTS: Alert[] = [
  { id: 'a_001', org_id: SEED_ORG_ID, employee_id: 'e_003', severity: 'warning', state: 'open', type: 'health', message: 'Frequência cardíaca elevada', created_at: minutesAgo(8), acknowledged_at: null, closed_at: null },
  { id: 'a_002', org_id: SEED_ORG_ID, employee_id: 'e_010', severity: 'critical', state: 'acknowledged', type: 'health', message: 'Possível queda detectada', created_at: minutesAgo(15), acknowledged_at: minutesAgo(12), closed_at: null },
  { id: 'a_003', org_id: SEED_ORG_ID, employee_id: 'e_005', severity: 'info', state: 'closed', type: 'meteorologic', message: 'Aviso de chuva forte na região', created_at: hoursAgo(2), acknowledged_at: hoursAgo(2), closed_at: hoursAgo(1) },
  { id: 'a_004', org_id: SEED_ORG_ID, employee_id: 'e_001', severity: 'warning', state: 'closed', type: 'health', message: 'Bateria baixa do dispositivo', created_at: hoursAgo(5), acknowledged_at: hoursAgo(5), closed_at: hoursAgo(4) },
  { id: 'a_005', org_id: SEED_ORG_ID, employee_id: 'e_004', severity: 'info', state: 'closed', type: 'manual', message: 'Início de jornada confirmado', created_at: hoursAgo(8), acknowledged_at: hoursAgo(8), closed_at: hoursAgo(8) },
]
