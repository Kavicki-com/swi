// Mapeadores DTO backend (Conversation/Message/Contact) → shapes da UI
// (ChatContact/ChatMessage do mockApi/chats), pra reusar ChatInbox + DS
// ChatSection sem alteração. Puros; datas ISO viram "HH:MM" via timeOf.
import type { Conversation, Message, Contact } from './types'
import { conversationKey, resolveContact, unreadFor } from './chatReducers'
import type { ChatContact, ChatMessage } from '../mockApi/chats'

export const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function messageToUi(m: Message, myId: string): ChatMessage {
  return {
    id: m.id,
    text: m.body,
    sender: m.senderId === myId ? 'me' : 'them',
    time: timeOf(m.sentAt),
    imageUri: m.imageUri ?? undefined,
  }
}

export function conversationToContact(c: Conversation, msgs: Message[], myId: string): ChatContact {
  const r = resolveContact(c, myId)
  return {
    id: c.id, name: r.name, sector: r.subtitle, avatarUri: r.avatarUri,
    subtitle: r.subtitle, unreadCount: unreadFor(c, myId) || undefined,
    messages: msgs.map((m) => messageToUi(m, myId)),
  }
}

export function directoryToContact(d: Contact, myId: string): ChatContact {
  return {
    id: conversationKey(myId, d.workerId), name: d.name, sector: d.sector,
    avatarUri: d.avatarUri, role: d.role, subtitle: d.sector,
  }
}
