// Smoke + wiring tests for ChatInbox.
// - The ChatBubble tests (B1) are pure-component and stay untouched.
// - The wiring tests (B2) mock the ChatProvider module so ChatInbox renders
//   against controlled backend-shaped data with spies for openConversation/send.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { Conversation, Message, Contact } from '@/services/chat/types'
import type { ChatContact, ChatMessage } from '@/services/chats'
import { clearSession, renderPage } from '@/test-utils/renderPage'

// The mock's live value + spies. vi.hoisted so the vi.mock factory (hoisted to
// the top of the module) can close over them. beforeEach swaps in a fresh
// fixture per test so spy history / draft state doesn't leak.
const chat = vi.hoisted(() => ({
  value: null as unknown,
}))
vi.mock('@/services/chat/ChatProvider', () => ({
  ChatProvider: ({ children }: { children: React.ReactNode }) => children,
  useChat: () => chat.value,
}))

import { ChatBubble, ChatInbox } from './ChatInbox'

const keyFor = (workerId: string): string => ['me', workerId].sort().join('#')

const CONV: Conversation = {
  id: 'me#w1',
  participants: ['me', 'w1'],
  participantNames: ['Eu', 'Romulo Cardoso'],
  participantSubtitles: ['', 'Setor Norte'],
  participantAvatars: ['', 'blob:av'],
  lastMessageBody: 'Olá admin',
  lastMessageAt: '2026-07-23T10:00:00Z',
  unreadBy: {},
}
const MSG: Message = {
  id: 'm1',
  conversationId: 'me#w1',
  participants: ['me', 'w1'],
  senderId: 'w1',
  body: 'Olá admin',
  imageUri: null,
  sentAt: '2026-07-23T10:00:00Z',
}
const DIR: Contact = {
  workerId: 'w1',
  name: 'Romulo Cardoso',
  sector: 'Setor Norte',
  role: 'Operador de escavadeira',
  avatarUri: 'blob:av',
}

let openConversation: ReturnType<typeof vi.fn>
let send: ReturnType<typeof vi.fn>

function setChat(over: Record<string, unknown> = {}) {
  openConversation = vi.fn(async () => {})
  send = vi.fn(async () => ({ error: null }))
  chat.value = {
    myId: 'me',
    loadStatus: 'ready',
    conversations: [CONV],
    messagesByConv: { 'me#w1': [MSG] },
    directory: [DIR],
    load: vi.fn(async () => {}),
    openConversation,
    send,
    keyFor,
    ...over,
  }
}

describe('ChatInbox', () => {
  beforeEach(() => setChat())
  afterEach(clearSession)

  it('renders without crashing', () => {
    expect(() => renderPage(<ChatInbox />, { route: '/chat' })).not.toThrow()
  })

  it('lists the real conversation by contact name', () => {
    renderPage(<ChatInbox />, { route: '/chat' })
    // Name appears in the left contact list (and again in the right info panel).
    expect(screen.getAllByText('Romulo Cardoso').length).toBeGreaterThan(0)
  })

  it('opens the default (first) conversation on mount', async () => {
    renderPage(<ChatInbox />, { route: '/chat' })
    await waitFor(() => expect(openConversation).toHaveBeenCalledWith('me#w1'))
  })

  it('sends the typed text via the provider without local append', async () => {
    renderPage(<ChatInbox />, { route: '/chat' })
    fireEvent.change(screen.getByPlaceholderText('Digite aqui sua mensagem'), {
      target: { value: 'Nova mensagem de teste' },
    })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('me#w1', 'Nova mensagem de teste'),
    )
    // No optimistic append: the typed text must not appear as a chat bubble
    // (the socket echo — not tested here — is what would surface it).
    expect(screen.queryByText('Nova mensagem de teste')).toBeNull()
  })

  it('renders a friendly empty state when the inbox is empty', () => {
    setChat({ conversations: [], messagesByConv: {}, loadStatus: 'empty' })
    expect(() => renderPage(<ChatInbox />, { route: '/chat' })).not.toThrow()
    expect(
      screen.getByText('Selecione uma conversa para visualizar as mensagens'),
    ).toBeTruthy()
  })
})

const CONTACT: ChatContact = {
  id: 'chat-test',
  name: 'Fulano de Tal',
  sector: 'Setor Norte',
  avatarUri: 'blob:avatar',
}

describe('ChatBubble', () => {
  beforeEach(() => setChat())
  afterEach(clearSession)

  it('renders the image attachment when the message has an imageUri', () => {
    const message: ChatMessage = {
      id: 'm-img',
      text: '',
      sender: 'them',
      time: '10:30',
      imageUri: 'blob:some-attachment',
    }
    renderPage(<ChatBubble message={message} contact={CONTACT} />)
    expect(screen.getByTestId('chat-bubble-image')).toBeTruthy()
  })

  it('does not render an image box for a text-only message', () => {
    const message: ChatMessage = {
      id: 'm-text-only',
      text: 'Sem anexo aqui.',
      sender: 'them',
      time: '10:32',
    }
    renderPage(<ChatBubble message={message} contact={CONTACT} />)
    expect(screen.queryByTestId('chat-bubble-image')).toBeNull()
    expect(screen.getByText('Sem anexo aqui.')).toBeTruthy()
  })

  it('renders both the image and the text when the message has both', () => {
    const message: ChatMessage = {
      id: 'm-img-text',
      text: 'Segue a foto do sensor.',
      sender: 'me',
      time: '10:31',
      imageUri: 'blob:some-attachment',
    }
    renderPage(<ChatBubble message={message} contact={CONTACT} />)
    expect(screen.getByTestId('chat-bubble-image')).toBeTruthy()
    expect(screen.getByText('Segue a foto do sensor.')).toBeTruthy()
  })
})
