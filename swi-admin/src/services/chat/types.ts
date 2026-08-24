// Local mirror dos models Conversation/Message/Contact do swi-backend. Siblings
// são isolados, então NÃO importamos o Schema do backend.
//
// Arrays paralelos (`participants`/`participantNames`/...) mantêm a Conversation
// auto-suficiente pro card do inbox sem um join no diretório. `avatars`/`imageUri`
// são uris resolvidas. Datas são ISO strings; a
// ordenação por recência usa comparação lexicográfica (= cronológica).
import type { Gender } from '@/services/types/directory'

export interface Conversation {
  id: string
  participants: string[] // [myId, contactId] (ids de usuário do backend)
  participantNames: string[] // paralelo a participants
  participantSubtitles: string[] // "Setor Leste"
  participantAvatars: string[] // uris já resolvidas pelo backend
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
  imageUri: string | null // anexo já resolvido pelo backend
  sentAt: string // ISO datetime
  // Opcionais de propósito: mensagem vinda de um backend anterior, ou de
  // fixture antiga, simplesmente não é editada nem excluída, em vez de quebrar
  // a compilação dos arquivos de mockApi/ que montam Message à mão.
  editedAt?: string | null // ISO datetime — presente ⇒ a bolha mostra "editada"
  deletedAt?: string | null // ISO datetime — presente ⇒ lápide, sem texto nem anexo
}

// ---------------------------------------------------------------------------
// Tipos de VIEW do inbox. Conversation/Message acima são o formato do fio; estes
// são o formato que o ChatInbox e o DS desenham, e `chatMap.ts` traduz um no
// outro. Moraram dentro do módulo de simulação até a entrega do código-fonte:
// como a tela de produção depende deles, o lugar certo é aqui, junto do resto
// do contrato do domínio.
export type ChatMessage = {
  id: string
  text: string
  // 'them' = bolha recebida (esquerda, borda primary-light, avatar à esquerda).
  // 'me'   = bolha enviada (direita, borda secondary-light, avatar à direita).
  sender: 'me' | 'them'
  time: string
  // anexo resolvido (presigned); quando presente, a bolha mostra a imagem
  imageUri?: string
  // Marcas de revisão. Booleanas de propósito: a bolha só precisa saber SE, não
  // quando, e assim não depende do par undefined/null que o backend devolve.
  edited?: boolean
  deleted?: boolean
}

export type ChatContact = {
  id: string
  name: string
  sector: string
  avatarUri: string
  unreadCount?: number
  // Campos de perfil usados pelo painel da coluna direita quando este contato
  // é a conversa ativa.
  role?: string
  subtitle?: string
  // Mesmo vocabulário do diretório: o painel do chat mostra o gênero do MESMO
  // cadastro que a tela de detalhe, e um alias próprio aqui fazia as duas
  // discordarem sobre a mesma pessoa. undefined = não informado.
  gender?: Gender
  age?: number
  bloodType?: string
  allergies?: string
  fatigueRemaining?: string
  // Histórico já resolvido. O inbox recebe as mensagens junto do contato ativo
  // em vez de disparar uma segunda chamada ao selecionar.
  messages?: ReadonlyArray<ChatMessage>
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
