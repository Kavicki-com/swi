// Exames clínicos do próprio usuário logado. Espelha mobile/services/api/exams.ts:
// mesmo endpoint, mesmo contrato, backend único. O painel gravava em
// Profile.examKeys, que só guarda a chave do arquivo — sem nome nem validade,
// nenhuma tela conseguia desenhar o card, e o exame enviado sumia de vista.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'

export type Exam = {
  id: string
  name: string
  /** Data de CALENDÁRIO 'AAAA-MM-DD', e é a VALIDADE, não a realização. Sem
   *  hora de propósito: ISO com hora recuaria um dia ao formatar em UTC-3. */
  date: string
  fileUrl: string
}

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export const examsApi = {
  list: async (): Promise<ServiceResponse<Exam[]>> => {
    try {
      return { data: await apiFetch<Exam[]>('/profile/exams'), error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao carregar os exames') } }
    }
  },

  // Dois passos porque o arquivo vai direto pro bucket via URL presignada: o
  // backend só recebe a key no fim. Quem sobe é o uploadImage(file, 'exams').
  create: async (input: {
    name: string
    date: string
    fileKey: string
  }): Promise<ServiceResponse<Exam>> => {
    try {
      const created = await apiFetch<Exam>('/profile/exams', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return { data: created, error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao enviar o exame') } }
    }
  },
}
