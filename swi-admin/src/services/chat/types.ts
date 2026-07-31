// Local mirror dos models Conversation/Message/Contact do swi-backend. Siblings
// são isolados, então NÃO importamos o Schema do backend.
//
// Arrays paralelos (`participants`/`participantNames`/...) mantêm a Conversation
// auto-suficiente pro card do inbox sem um join no diretório. `avatars`/`imageUri`
// são uris resolvidas. Datas são ISO strings; a
// ordenação por recência usa comparação lexicográfica (= cronológica).
export interface Conversation {
  id: string
  participants: string[] // [myId, contactId] (Cognito subs)
  participantNames: string[] // paralelo a participants
  participantSubtitles: string[] // "Setor Leste"
  participantAvatars: string[] // uris (resolvidas de keys no amplify)
  lastMessageBody: string
  lastMessageAt: string | null // ISO datetime
  unreadBy: Record<string, number> // sub -> count (de unreadByJson)
}

export interface Message {
  id: string
  conversationId: string
  participants: string[]
  senderId: string // === myId ⇒ bubble "me"
  body: string
  imageUri: string | null // anexo resolvido (de imageKey no amplify)
  sentAt: string // ISO datetime
  // QA Web #4. Opcionais de propósito: mensagem vinda de um backend anterior
  // (ou de fixture antiga) simplesmente não é editada nem excluída, em vez de
  // quebrar a compilação dos 6 arquivos de mockApi/ que montam Message à mão.
  editedAt?: string | null // ISO datetime — presente ⇒ a bolha mostra "editada"
  deletedAt?: string | null // ISO datetime — presente ⇒ lápide, sem texto nem anexo
}

export interface Contact {
  workerId: string
  name: string
  sector: string // → subtitle do card
  role: string // header do user-info
  avatarUri: string // uri resolvida
  // Identidade clínica REAL do Profile (o painel do chat mostrava valores
  // fixos "26 anos / O+" pra todo contato antes disto). null = não preenchido.
  birthDate: string | null // ISO
  bloodType: string | null
  allergies: string | null
  gender: string | null // 'male' | 'female' | null (não informado)
}
