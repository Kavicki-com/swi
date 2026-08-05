// Fachada do chat — 100% real: `api/chats.ts` fala com o backend Nest, e o
// ChatProvider traduz o formato do fio (Conversation/Message) nos tipos de view
// que o inbox desenha. Re-export fino, mesmo movimento de dashboard/monitoring.
export { chatsApi } from './api/chats'
export type { ChatContact, ChatMessage } from './chat/types'
