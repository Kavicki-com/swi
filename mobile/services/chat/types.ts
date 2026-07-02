// Local mirror dos models Conversation/Message/Contact do swi-backend. Siblings
// são isolados, então NÃO importamos o Schema do backend; após deploy, `ampx
// generate graphql-client-code --out` pode substituir por tipos gerados.
// Mirrors services/journey/types.ts.
//
// Arrays paralelos (`participants`/`participantNames`/...) mantêm a Conversation
// auto-suficiente pro card do inbox sem um join no diretório. `avatars`/`imageUri`
// são uris resolvidas (de keys do S3 no amplify). Datas são ISO strings; a
// ordenação por recência usa comparação lexicográfica (= cronológica).
export interface Conversation {
  id: string;
  participants: string[];           // [myId, contactId] (Cognito subs)
  participantNames: string[];       // paralelo a participants
  participantSubtitles: string[];   // "Setor Leste"
  participantAvatars: string[];     // uris (resolvidas de keys no amplify)
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
  imageUri: string | null;          // anexo resolvido (de imageKey no amplify)
  sentAt: string;                   // ISO datetime
}

export interface Contact {
  workerId: string;
  name: string;
  sector: string;                   // → subtitle do card
  role: string;                     // header do user-info
  avatarUri: string;                // uri resolvida
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
