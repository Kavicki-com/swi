// Estado real do chat do painel admin. Espelha a estrutura do ChatProvider do
// mobile (services/chat/ChatProvider.tsx): carga via REST + mensagens ao vivo
// via socket, com um espelho síncrono (ref) de `conversations` pro listener não
// fechar sobre state velho. Diferenças da versão admin:
//  - a camada api/ devolve o envelope { data, error } (NÃO lança);
//  - myId vem de useAuth().user?.id (não de um getter de sessão);
//  - send recebe um File do browser, subido via uploadImage(file, 'chat').
// Serve tanto o inbox quanto o painel lateral (tasks posteriores consomem).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import type { Conversation, Contact, Message } from './types'
import {
  applyMessage,
  markRead as markReadReducer,
  conversationKey,
  sortByRecent,
} from './chatReducers'
import { subscribeMessages } from './chatSocket'
import { chatsApi } from '../api/chats'
import { uploadImage } from '../api/upload'
import { useAuth } from '@/hooks/useAuth'
import type { MockError } from '@/services/mockApi/types'

type LoadStatus = 'loading' | 'ready' | 'empty' | 'error'

interface ChatContextValue {
  myId: string
  loadStatus: LoadStatus
  conversations: Conversation[]
  messagesByConv: Record<string, Message[]>
  directory: Contact[]
  load: () => Promise<void>
  openConversation: (conversationId: string) => Promise<void>
  closeConversation: () => void
  send: (conversationId: string, body: string, file?: File) => Promise<{ error: MockError | null }>
  keyFor: (workerId: string) => string
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: PropsWithChildren) {
  const { user } = useAuth()
  const myId = user?.id ?? ''

  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [directory, setDirectory] = useState<Contact[]>([])
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>({})

  // Espelho síncrono de `conversations`: o listener do socket lê daqui (e não do
  // state var) pra decidir se a mensagem pertence a uma conversa já conhecida,
  // sem fechar sobre um snapshot velho. applyConversations mantém os dois juntos.
  const conversationsRef = useRef<Conversation[]>([])
  const openConvRef = useRef<string | null>(null)
  // myId também espelhado: onMessage é registrado uma vez no mount e não deve
  // fechar sobre um myId vazio se a sessão resolver depois.
  const myIdRef = useRef(myId)
  useEffect(() => {
    myIdRef.current = myId
  }, [myId])

  const applyConversations = useCallback((next: Conversation[]) => {
    conversationsRef.current = next
    setConversations(next)
  }, [])

  const load = useCallback(async () => {
    setLoadStatus('loading')
    const [cRes, dRes] = await Promise.all([chatsApi.listConversations(), chatsApi.listDirectory()])
    if (cRes.error || dRes.error) {
      setLoadStatus('error')
      return
    }
    const cs = sortByRecent(cRes.data ?? [])
    applyConversations(cs)
    setDirectory(dRes.data ?? [])
    setLoadStatus(cs.length ? 'ready' : 'empty')
  }, [applyConversations])

  const onMessage = useCallback(
    (msg: Message) => {
      const me = myIdRef.current
      const known = conversationsRef.current.some((c) => c.id === msg.conversationId)
      if (known) {
        applyConversations(applyMessage(conversationsRef.current, msg))
      } else {
        // Conversa criada lazy (1ª mensagem a um contato novo) ainda não está no
        // state — applyMessage seria no-op. Buscamos a lista fresca do backend,
        // sem mexer no loadStatus (nada de flash de loading).
        // last-write-wins: server snapshot is source of truth; a concurrent socket msg may be re-fetched on next open
        chatsApi.listConversations().then(({ data, error }) => {
          if (error) return
          applyConversations(sortByRecent(data ?? []))
        })
      }
      // Append ao histórico já carregado da thread (inclui a 1ª msg de conversa
      // nova, se openConversation já inicializou messagesByConv[convId]).
      setMessagesByConv((prev) => {
        const existing = prev[msg.conversationId]
        return existing ? { ...prev, [msg.conversationId]: [...existing, msg] } : prev
      })
      // Mensagem do outro na conversa aberta → zera o badge ao vivo.
      if (openConvRef.current === msg.conversationId && msg.senderId !== me) {
        chatsApi.markRead(msg.conversationId)
        applyConversations(markReadReducer(conversationsRef.current, msg.conversationId, me))
      }
    },
    [applyConversations],
  )

  useEffect(() => {
    load()
    const stop = subscribeMessages(onMessage)
    return stop
    // Registra uma vez no mount; onMessage/load são estáveis e leem refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openConversation = useCallback(
    async (conversationId: string) => {
      openConvRef.current = conversationId
      // Conversa nova (contato do diretório sem thread ainda) não existe no
      // backend — ela é criada lazy no 1º send. listMessages/markRead
      // devolveriam 404 (barulho no console). Uma thread nova não tem mensagem
      // nem unread: inicializa vazia (se ainda não houver) e sai. O echo do 1º
      // send chega via socket, onMessage refaz a lista e o append usa este [].
      const known = conversationsRef.current.some((c) => c.id === conversationId)
      if (!known) {
        setMessagesByConv((prev) =>
          prev[conversationId] ? prev : { ...prev, [conversationId]: [] },
        )
        return
      }
      // last-write-wins: server snapshot is source of truth; a concurrent socket msg may be re-fetched on next open
      // TODO(followup): listMessages error currently shows as empty thread; no per-thread error surface yet
      const { data } = await chatsApi.listMessages(conversationId)
      setMessagesByConv((prev) => ({ ...prev, [conversationId]: data ?? [] }))
      await chatsApi.markRead(conversationId)
      applyConversations(markReadReducer(conversationsRef.current, conversationId, myIdRef.current))
    },
    [applyConversations],
  )

  // Limpa a conversa ativa ao sair do inbox. Sem isso, openConvRef fica travado
  // no último id aberto e onMessage marcaria como lida uma mensagem que chega
  // depois que o admin já saiu da tela — zerando o badge sem ninguém ter visto.
  // Estável (deps vazias) pro cleanup de unmount do ChatInbox não re-disparar.
  const closeConversation = useCallback(() => {
    openConvRef.current = null
  }, [])

  const send = useCallback(async (conversationId: string, body: string, file?: File) => {
    // Sem otimista: o echo da mensagem volta pelo socket (onMessage) e atualiza o
    // state — evita a complexidade de dedup. O dto sem imagem é exatamente
    // { body } (nada de imageKey: undefined) pra casar o contrato do backend.
    //
    // uploadImage LANÇA (tipo inválido, >15MB, presign 403, queda de rede) — não
    // é enveloped como a camada api/. Sem este try o caminho de imagem (o mais
    // propenso a falhar) rejeitaria enquanto o de texto devolve { error },
    // quebrando o contrato Promise<{ error }> e dando unhandled rejection na UI.
    let imageKey: string | undefined
    if (file) {
      try {
        imageKey = await uploadImage(file, 'chat')
      } catch (e) {
        return { error: { message: e instanceof Error ? e.message : 'Falha ao enviar imagem' } }
      }
    }
    const { error } = await chatsApi.sendMessage(
      conversationId,
      imageKey ? { body, imageKey } : { body },
    )
    return { error }
  }, [])

  const keyFor = useCallback((workerId: string) => conversationKey(myId, workerId), [myId])

  const value = useMemo<ChatContextValue>(
    () => ({
      myId,
      loadStatus,
      conversations,
      messagesByConv,
      directory,
      load,
      openConversation,
      closeConversation,
      send,
      keyFor,
    }),
    [
      myId,
      loadStatus,
      conversations,
      messagesByConv,
      directory,
      load,
      openConversation,
      closeConversation,
      send,
      keyFor,
    ],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used inside ChatProvider')
  return ctx
}
