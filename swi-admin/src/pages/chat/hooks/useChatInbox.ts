// src/pages/chat/hooks/useChatInbox.ts
// Estado, efeitos e handlers do inbox de chat. Extraído de ChatInbox.tsx sem
// mudança de comportamento: a página passou a ser só layout, e todo o
// acoplamento com o ChatProvider, com a URL e com o compositor mora aqui.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDemoToast } from '@/lib/demoToast'
import type { ChatContact, ChatMessage } from '@/services/chats'
import { useChat } from '@/services/chat/ChatProvider'
import { conversationToContact, directoryToContact } from '@/services/chat/chatMap'
import { ageFrom, toGender } from '@/services/api/users'
import { simulatedVitalsFor } from '@/services/vitals/simulatedVitals'

export function useChatInbox() {
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  // Real chat state from the backend-backed provider (REST load + live socket).
  const {
    conversations,
    messagesByConv,
    directory,
    myId,
    openConversation,
    closeConversation,
    send,
    editMessage,
    keyFor,
    loadStatus,
  } = useChat()
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  // Optional image attachment for the next send. The provider's `send` does the
  // upload (uploadImage → object key); the composer only holds the picked File
  // and hands it over. Cleared on a successful send, kept on error for retry.
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  // Hidden native <input type="file"> we trigger via the attach button. Not a DS
  // primitive: a browser control, so a raw ref-driven input is appropriate.
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Guard against double-send: `handleSend` awaits before clearing `draft`, so
  // two fast clicks would both read the same draft and fire duplicate messages.
  const [sending, setSending] = useState(false)
  // "Novo Chat" mode: swaps the left list from active conversations to the full
  // directory so a fresh conversation can be started. Picking a directory
  // contact navigates to its deterministic conversation id (keyFor), the same
  // id an existing conversation would already carry, so it just opens either way.
  const [newChatOpen, setNewChatOpen] = useState(false)

  // Selection is URL-driven via /chat/:contactId so deep-links (e.g. clicks
  // from the AppLayout chat sidebar) open the right conversation. Conversation
  // ids contain '#'; react-router DECODES the param, so `contactId` is already
  // the raw id: use it directly (no re-decode). The URL param is the single
  // source of truth for the selection.
  const { contactId } = useParams<{ contactId?: string }>()
  const selectedContactId = contactId

  // Active conversations mapped to the UI ChatContact shape (identity + thread).
  const contacts = conversations.map((c) =>
    conversationToContact(c, messagesByConv[c.id] ?? [], myId),
  )
  // Directory contacts for the "Novo Chat" flow, no thread; carries `role`.
  const directoryContacts = directory.map((d) => directoryToContact(d, myId))

  // Pin the default selection ONCE into the URL. `contacts` is sortByRecent-
  // ordered, so an incoming message on another thread can leapfrog it to index
  // 0; if the default tracked `contacts[0]` live it would flip the selected
  // thread AND markRead a conversation the admin never opened. Navigating
  // (replace) pins it via the param, after which re-sorts can't re-drive it.
  const firstContactId = contacts[0]?.id
  useEffect(() => {
    if (!contactId && firstContactId) {
      navigate(`/chat/${encodeURIComponent(firstContactId)}`, { replace: true })
    }
  }, [contactId, firstContactId, navigate])

  // Load the selected thread's messages + mark it read once the URL pins a real
  // conversation id.
  useEffect(() => {
    if (selectedContactId) openConversation(selectedContactId)
  }, [selectedContactId, openConversation])

  // Ao desmontar o inbox (admin navega pra outra tela), libera a conversa ativa
  // no provider: que permanece montado como ancestral de layout-route. Sem
  // isso, uma mensagem que chega depois seria marcada como lida sem ninguém ter
  // aberto a tela, zerando o badge de não-lidas da sidebar. closeConversation é
  // estável (useCallback deps vazias), então o cleanup roda só no unmount.
  useEffect(() => () => closeConversation(), [closeConversation])

  // Backend-down surface: toast once per error episode so a failed load doesn't
  // silently read as an empty inbox (the middle placeholder also switches copy).
  const errorToastedRef = useRef(false)
  useEffect(() => {
    if (loadStatus === 'error' && !errorToastedRef.current) {
      errorToastedRef.current = true
      showToast('Não foi possível carregar as conversas.')
    }
    if (loadStatus !== 'error') errorToastedRef.current = false
  }, [loadStatus, showToast])

  const listSource = newChatOpen ? directoryContacts : contacts
  const filtered = listSource.filter((c) =>
    search.trim() ? c.name.toLowerCase().includes(search.toLowerCase()) : true,
  )
  const selectedContact = contacts.find((c) => c.id === selectedContactId) ?? null
  const messages = selectedContact?.messages ?? []

  // Identidade REAL do painel: nome, setor e avatar vêm da conversa; idade,
  // tipo sanguíneo e alergias vêm do DIRETÓRIO. Servir esses campos de um
  // conjunto fixo faria o painel contradizer as demais telas do mesmo
  // trabalhador. Só a fadiga segue simulada, com o mesmo gerador do resto do
  // painel.
  const panelContact: ChatContact | null = selectedContact
    ? (() => {
        const entry = directory.find((d) => keyFor(d.workerId) === selectedContact.id)
        const vitals = entry ? simulatedVitalsFor(entry.workerId, Date.now()) : null
        return {
          ...selectedContact,
          role: entry?.role ?? '',
          // Gênero REAL do cadastro, pela MESMA tradução do diretório. O
          // ternário anterior só reconhecia 'female' e mandava todo o resto pra
          // 'male': quem se declarou fora do binário, e quem não preencheu o
          // campo (inclusive todo contato sem entrada no diretório), aparecia
          // no painel declarado como "Masculino".
          gender: toGender(entry?.gender),
          username: entry?.username ?? undefined,
          age: entry?.birthDate ? ageFrom(entry.birthDate, new Date()) : undefined,
          bloodType: entry?.bloodType ?? undefined,
          allergies: entry?.allergies ?? undefined,
          fatigueRemaining: vitals
            ? `${Math.floor(vitals.fatigueMinutes / 60)}h${String(vitals.fatigueMinutes % 60).padStart(2, '0')}`
            : '—',
        }
      })()
    : null

  const openContact = (id: string) => {
    // Composing to a brand-new directory contact (no conversation yet) briefly
    // shows a blank middle/right until the first send's socket echo refetches
    // the list into `conversations`: expected until the echo lands.
    navigate(`/chat/${encodeURIComponent(id)}`)
    setNewChatOpen(false)
  }

  const toggleNewChat = () => setNewChatOpen((v) => !v)

  const handleSend = async () => {
    const text = draft.trim()
    // An image-only message (empty text + a pending image) is valid, the
    // backend accepts body OR imageKey and only 400s when BOTH are empty.
    if ((!text && !pendingImage) || !selectedContactId || sending) return
    setSending(true)
    try {
      const { error } = await send(selectedContactId, text, pendingImage ?? undefined)
      if (error) {
        // Keep BOTH draft and pendingImage so the user can retry the same send.
        showToast(error.message)
      } else {
        setDraft('')
        setPendingImage(null)
      }
    } finally {
      setSending(false)
    }
  }

  // Mensagem em denúncia. O modal mora na PÁGINA (não na bolha) pelo mesmo
  // motivo do editingId: a bolha vive num container com overflow que
  // recortaria o modal, e o modo pertence à página.
  const [reportingMessage, setReportingMessage] = useState<ChatMessage | null>(null)

  // Modo edição. O compositor é o mesmo campo: entrar em edição carrega o texto
  // atual, e o CTA troca de "Enviar" para "Salvar". `editingId` é a única fonte
  // do modo: vazio significa composição normal.
  const [editingId, setEditingId] = useState<string | null>(null)
  const startEdit = (message: ChatMessage) => {
    setEditingId(message.id)
    setDraft(message.text)
  }
  const cancelEdit = () => {
    setEditingId(null)
    setDraft('')
  }
  const handleSaveEdit = async () => {
    const text = draft.trim()
    if (!text || !selectedContactId || !editingId || sending) return
    setSending(true)
    try {
      const { error } = await editMessage(selectedContactId, editingId, text)
      if (error) {
        // Mantém o rascunho: quem acabou de corrigir não deve reescrever.
        showToast(error.message)
      } else {
        cancelEdit()
      }
    } finally {
      setSending(false)
    }
  }

  // Keep the chat thread anchored to the latest message: scroll to bottom
  // whenever messages append OR the user switches contacts. Older messages
  // remain reachable by scrolling up manually inside the box.
  const chatBoxRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight
    }
  }, [messages.length, selectedContactId])

  return {
    search,
    setSearch,
    draft,
    setDraft,
    pendingImage,
    setPendingImage,
    fileInputRef,
    sending,
    newChatOpen,
    toggleNewChat,
    selectedContactId,
    filtered,
    selectedContact,
    messages,
    panelContact,
    loadStatus,
    openContact,
    handleSend,
    reportingMessage,
    setReportingMessage,
    editingId,
    startEdit,
    cancelEdit,
    handleSaveEdit,
    chatBoxRef,
  }
}
