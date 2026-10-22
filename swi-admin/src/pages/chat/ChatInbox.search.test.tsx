// Botão "Pesquisar" do meio do inbox: abre o campo de busca do DS e filtra as
// mensagens da conversa aberta pelo texto. Arquivo próprio porque
// ChatInbox.test.tsx está no limite de tamanho.
import type { ReactNode } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { Contact, Conversation, Message } from '@/services/chat/types'
import { renderPage } from '@/test-utils/renderPage'

const chat = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/services/chat/ChatProvider', () => ({
  ChatProvider: ({ children }: { children: ReactNode }) => children,
  useChat: () => chat.value,
}))
const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/demoToast', () => ({
  useDemoToast: () => toast,
  DemoToastProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => null }))
vi.mock('@/services/api/telemetryDevices', () => ({
  telemetryDevicesApi: {
    stateOf: async () => ({ data: { device: null, pendingEnrollment: null }, error: null }),
  },
}))
vi.mock('@/services/api/telemetry', () => ({ telemetryApi: { workerCurrent: vi.fn() } }))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: () => () => {},
}))

import { ChatInbox } from './ChatInbox'

const keyFor = (workerId: string): string => ['me', workerId].sort().join('#')

const CONV: Conversation = {
  id: 'me#w1',
  participants: ['me', 'w1'],
  participantNames: ['Eu', 'Romulo Cardoso'],
  participantSubtitles: ['', 'Setor Norte'],
  participantAvatars: ['', ''],
  lastMessageBody: 'Precisamos de mais explosivos',
  lastMessageAt: '2026-07-23T10:05:00Z',
  unreadBy: {},
}
const ROMULO: Contact = {
  workerId: 'w1',
  name: 'Romulo Cardoso',
  sector: 'Setor Norte',
  role: 'Operador',
  avatarUri: '',
  birthDate: null,
  bloodType: null,
  allergies: null,
  gender: null,
  username: null,
}
const msg = (id: string, body: string, sentAt: string): Message => ({
  id,
  conversationId: 'me#w1',
  participants: ['me', 'w1'],
  senderId: 'w1',
  body,
  imageUri: null,
  sentAt,
})
const MESSAGES = [
  msg('m1', 'Alguma novidade sobre a detonação na área 7?', '2026-07-23T10:00:00Z'),
  msg('m2', 'Precisamos de mais explosivos', '2026-07-23T10:05:00Z'),
]

function setChat(conversations: Conversation[]) {
  chat.value = {
    myId: 'me',
    loadStatus: 'ready',
    conversations,
    messagesByConv: { 'me#w1': MESSAGES },
    directory: [ROMULO],
    load: vi.fn(async () => {}),
    openConversation: vi.fn(async () => {}),
    closeConversation: vi.fn(),
    send: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
    keyFor,
  }
}

const ROUTE = { route: '/chat/me%23w1', path: '/chat/:contactId' }

beforeEach(() => toast.show.mockClear())

describe('ChatInbox: Pesquisar mensagens', () => {
  it('abre o campo de busca e filtra as mensagens da conversa pelo texto', async () => {
    setChat([CONV])
    await renderPage(<ChatInbox />, ROUTE)
    expect(screen.getByText('Precisamos de mais explosivos')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar mensagens' }))
    fireEvent.change(screen.getByTestId('chat-message-search'), {
      target: { value: 'DETONAÇÃO' },
    })

    expect(screen.getByText('Alguma novidade sobre a detonação na área 7?')).toBeTruthy()
    expect(screen.queryByText('Precisamos de mais explosivos')).toBeNull()
    expect(toast.show).not.toHaveBeenCalled()
  })

  it('sem mensagem que case, diz que não há resultado', async () => {
    setChat([CONV])
    await renderPage(<ChatInbox />, ROUTE)

    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar mensagens' }))
    fireEvent.change(screen.getByTestId('chat-message-search'), {
      target: { value: 'guindaste' },
    })

    expect(screen.getByText('Nenhum resultado')).toBeTruthy()
  })

  it('fechar a busca devolve a conversa inteira', async () => {
    setChat([CONV])
    await renderPage(<ChatInbox />, ROUTE)

    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar mensagens' }))
    fireEvent.change(screen.getByTestId('chat-message-search'), {
      target: { value: 'guindaste' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar mensagens' }))

    expect(screen.queryByTestId('chat-message-search')).toBeNull()
    expect(screen.getByText('Precisamos de mais explosivos')).toBeTruthy()
  })

  it('sem conversa aberta, não há o que pesquisar', async () => {
    setChat([])
    await renderPage(<ChatInbox />, { route: '/chat' })

    expect(screen.getByRole('button', { name: 'Pesquisar mensagens' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
