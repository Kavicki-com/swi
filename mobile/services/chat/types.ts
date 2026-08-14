// Local mirror dos models Conversation/Message/Contact do swi-backend. Siblings
// são isolados, então NÃO importamos os tipos do backend: este arquivo é a
// fronteira do contrato REST e precisa ser conferido à mão quando ele mudar.
// Mirrors services/journey/types.ts.
//
// Arrays paralelos (`participants`/`participantNames`/...) mantêm a Conversation
// auto-suficiente pro card do inbox sem um join no diretório. `avatars`/`imageUri`
// são uris já resolvidas pelo backend (presigned). Datas são ISO strings; a
// ordenação por recência usa comparação lexicográfica (= cronológica).
export interface Conversation {
  id: string;
  participants: string[];           // [myId, contactId] (ids do backend)
  participantNames: string[];       // paralelo a participants
  participantSubtitles: string[];   // "Setor Leste"
  participantAvatars: string[];     // uris presigned
  lastMessageBody: string;
  lastMessageAt: string | null;     // ISO datetime
  unreadBy: Record<string, number>; // sub -> count (de unreadByJson)
}

export interface Message {
  id: string;
  conversationId: string;
  participants: string[];
  senderId: string;                 // === myId ⇒ bubble "me"
  body: string;
  imageUri: string | null;          // anexo já resolvido (presigned)
  sentAt: string;                   // ISO datetime
}

export interface Contact {
  workerId: string;
  name: string;
  sector: string;                   // → subtitle do card
  role: string;                     // header do user-info
  avatarUri: string;                // uri resolvida
  // Identidade clínica real do contato, vinda do /chat/directory. Declarar os
  // campos aqui é o que impede a ficha de exibir valores cravados iguais para
  // qualquer pessoa que o usuário abra. null significa que o colega não
  // preencheu, e a tela mostra "não informado", nunca um palpite.
  birthDate?: string | null;        // ISO datetime
  bloodType?: string | null;
  allergies?: string | null;
  gender?: string | null;           // código: 'male' | 'female' | 'other'
}

export interface ChatBackend {
  readonly myId: string;            // sub do worker logado (mock = 'me')
  listConversations(): Promise<Conversation[]>;
  listMessages(conversationId: string): Promise<Message[]>;
  listDirectory(): Promise<Contact[]>;
  // cria-ou-anexa: se a conversa (id determinístico) não existe, cria do diretório
  sendMessage(conversationId: string, body: string, imageUri?: string): Promise<Message>;
  markRead(conversationId: string): Promise<void>;
  // conversationId === null ⇒ canal global (inbox); senão a thread daquela conversa
  subscribe(conversationId: string | null, cb: (msg: Message) => void): () => void;
}
