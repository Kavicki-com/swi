// Client REST do chat do painel admin contra o backend Nest. Espelha o envelope
// MockResponse dos outros módulos de api/ (ver api/users.ts) pra que as telas de
// chat não mudem de contrato: todo retorno é { data, error } com error no shape
// MockError ({ message }), nunca o ApiError cru — consistência com a camada api/.
import type { MockResponse } from '@/services/mockApi/types'
import type { Conversation, Message, Contact } from '@/services/chat/types'
import { apiFetch } from './http'

// ids de conversa contêm '#' (formato `a#b`) — delimitador de fragmento de URL,
// então TODO path que embute o id precisa de encodeURIComponent.
const conv = (id: string) => `/chat/conversations/${encodeURIComponent(id)}`

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

// Envolve uma chamada apiFetch no envelope MockResponse: sucesso → { data, null },
// falha (qualquer ApiError: rede, 4xx, 5xx) → { null, { message } }.
async function envelope<T>(p: Promise<T>, fallback = 'Falha na ação'): Promise<MockResponse<T>> {
  try {
    return { data: await p, error: null }
  } catch (e) {
    return { data: null, error: { message: errorMessage(e, fallback) } }
  }
}

export const chatsApi = {
  listConversations: () =>
    envelope(apiFetch<Conversation[]>('/chat/conversations'), 'Falha ao carregar conversas'),
  listDirectory: () =>
    envelope(apiFetch<Contact[]>('/chat/directory'), 'Falha ao carregar contatos'),
  listMessages: (id: string) =>
    envelope(apiFetch<Message[]>(`${conv(id)}/messages`), 'Falha ao carregar mensagens'),
  sendMessage: (id: string, dto: { body?: string; imageKey?: string }) =>
    envelope(
      apiFetch<Message>(`${conv(id)}/messages`, { method: 'POST', body: JSON.stringify(dto) }),
      'Falha ao enviar mensagem',
    ),
  // QA Web #4 — editar e excluir mensagem. Os dois devolvem a mensagem no
  // estado novo, e não 204: quem chamou aplica o retorno na hora, sem depender
  // de o socket chegar.
  editMessage: (id: string, messageId: string, body: string) =>
    envelope(
      apiFetch<Message>(`${conv(id)}/messages/${encodeURIComponent(messageId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      }),
      'Falha ao editar mensagem',
    ),
  deleteMessage: (id: string, messageId: string) =>
    envelope(
      apiFetch<Message>(`${conv(id)}/messages/${encodeURIComponent(messageId)}`, {
        method: 'DELETE',
      }),
      'Falha ao excluir mensagem',
    ),
  markRead: (id: string) => envelope(apiFetch<null>(`${conv(id)}/read`, { method: 'POST' })),
}
