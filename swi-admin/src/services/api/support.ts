// O "Solicitar suporte" do settings fala com POST /support, rota PÚBLICA no
// backend (suporte precisa funcionar até deslogado). Logado, o modal manda o
// e-mail da sessão pra facilitar retorno.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'

export const supportApi = {
  send: async (input: {
    reason: string
    title: string
    message: string
    email?: string
  }): Promise<ServiceResponse<{ sent: true }>> => {
    try {
      await apiFetch<unknown>('/support', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return { data: { sent: true }, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao enviar solicitação' },
      }
    }
  },
}
