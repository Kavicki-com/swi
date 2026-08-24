// Contratos de view do diretório (Colaboradores e Admins): consumidos pelas
// telas e produzidos tanto por api/users.ts (backend real) quanto pelas
// simulações de mockApi/. Módulo neutro de propósito: o caminho de produção
// não importa nada do namespace de simulação.

/**
 * Gênero DECLARADO no cadastro, nos códigos que o backend grava. `other` cobre
 * quem se declarou não-binário ou "outro" no formulário; a AUSÊNCIA do campo
 * (undefined) é o estado separado de quem preferiu não responder, e as telas
 * escrevem "Não informado" só nesse caso.
 */
export type Gender = 'male' | 'female' | 'other'

export type ExamEntry = {
  id: string
  year: string
  date: string
  title: string
  /**
   * Campo morto: as entradas de demo o preenchem com '' e nenhuma tela o
   * renderiza (o WorkerExamEntry do layout nem o declara). Opcional para que o
   * exame REAL, vindo da tabela Exam, não precise inventar uma string vazia
   * só para satisfazer o tipo.
   */
  subtitle?: string
  /**
   * URL presignada do arquivo, quando o exame veio da tabela Exam real. As
   * entradas de demo não têm arquivo, por isso é opcional: sem ela o card não
   * oferece download em vez de oferecer um que não baixa nada.
   */
  fileUrl?: string
}

// /employees list, UI-shaped.
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
  // Health/details fields used by EmployeeDetails: mirror the Admin shape so
  // the screen renders without per-field optionality.
  gender?: Gender
  bpm?: number
  pressure?: string
  fatigueRate?: number
  effort?: number
  fatigueMinutes?: number
  statusLabel?: string
  allergies?: ReadonlyArray<string>
  examHistory?: ReadonlyArray<ExamEntry>
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
  // Health fields used by the AdminDetails screen.
  gender?: Gender
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
