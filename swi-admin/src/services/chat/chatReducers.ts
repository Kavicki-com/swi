// Lógica PURA da lista de conversas, compartilhada pelo mock backend e pelo
// ChatProvider. Sem efeitos/relógio: `sentAt` chega pronto na Message; ordenação
// por ISO string (lexicográfica = cronológica). Espelha o estilo puro de
// services/journey/progress.ts.
import type { Conversation, Message } from './types'

export function conversationKey(a: string, b: string): string {
  return [a, b].sort().join('#')
}

export function unreadFor(c: Conversation, myId: string): number {
  return c.unreadBy[myId] ?? 0
}

export interface ResolvedContact {
  workerId: string
  name: string
  subtitle: string
  avatarUri: string
}

export function resolveContact(c: Conversation, myId: string): ResolvedContact {
  const found = c.participants.findIndex((p) => p !== myId)
  const i = found === -1 ? 0 : found
  return {
    workerId: c.participants[i] ?? '',
    name: c.participantNames[i] ?? '',
    subtitle: c.participantSubtitles[i] ?? '',
    avatarUri: c.participantAvatars[i] ?? '',
  }
}

export function sortByRecent(cs: Conversation[]): Conversation[] {
  return [...cs].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
}

/**
 * Se a mensagem que chegou é uma REVISÃO (editada ou excluída) e não uma
 * estreia. O backend emite o mesmo evento 'message' nos dois casos, com o
 * estado atual, porque um evento novo faria cliente antigo ignorar a edição em
 * silêncio e seguir mostrando texto velho.
 */
export function isRevision(msg: Message): boolean {
  return Boolean(msg.editedAt || msg.deletedAt)
}

/**
 * Casa a mensagem no histórico pelo id: substitui no lugar se já existe, entra
 * no fim se é nova.
 *
 * O append cru duplicava a bolha na edição, porque o id volta o mesmo. E a
 * substituição preserva a POSIÇÃO: reinserir no fim faria a mensagem corrigida
 * pular pro rodapé da conversa, fora da ordem cronológica.
 */
export function upsertMessage(list: Message[], msg: Message): Message[] {
  const i = list.findIndex((m) => m.id === msg.id)
  if (i === -1) return [...list, msg]
  const next = [...list]
  next[i] = msg
  return next
}

export function applyMessage(cs: Conversation[], msg: Message): Conversation[] {
  // Revisão não toca na caixa de entrada, e as duas razões dão bug: o contador
  // de não lidas já foi incrementado quando a mensagem estreou, e usar o sentAt
  // de uma mensagem antiga como lastMessageAt rebaixaria a conversa na lista,
  // exibindo preview de mensagem que não é a última. O preview correto o
  // servidor já gravou, e ele chega no próximo carregamento.
  if (isRevision(msg)) return cs
  const next = cs.map((c) => {
    if (c.id !== msg.conversationId) return c
    const unreadBy = { ...c.unreadBy }
    for (const p of c.participants) {
      if (p !== msg.senderId) unreadBy[p] = (unreadBy[p] ?? 0) + 1
    }
    return {
      ...c,
      lastMessageBody: msg.body || (msg.imageUri ? '📷 Imagem' : ''),
      lastMessageAt: msg.sentAt,
      unreadBy,
    }
  })
  return sortByRecent(next)
}

export function markRead(cs: Conversation[], conversationId: string, myId: string): Conversation[] {
  return cs.map((c) =>
    c.id === conversationId ? { ...c, unreadBy: { ...c.unreadBy, [myId]: 0 } } : c,
  )
}
