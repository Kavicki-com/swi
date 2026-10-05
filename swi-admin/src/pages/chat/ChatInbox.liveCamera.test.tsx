// Botão "Ver câmera da posição" do painel do contato no chat. O id da
// conversa não é o do funcionário: quem sabe o id é o diretório, e o caminho
// inteiro (useChatInbox, painel do contato, botão) é o que se prova aqui.
// Arquivo próprio porque ChatInbox.test.tsx está no limite de tamanho.
import type { ReactNode } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { Contact, Conversation } from '@/services/chat/types'
import { renderPage } from '@/test-utils/renderPage'

const chat = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/services/chat/ChatProvider', () => ({
  ChatProvider: ({ children }: { children: ReactNode }) => children,
  useChat: () => chat.value,
}))
vi.mock('@/lib/demoToast', () => ({
  useDemoToast: () => ({ show: () => {} }),
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

const open = vi.hoisted(() => ({ fn: vi.fn(async (_id: string | undefined, _name: string) => {}) }))
vi.mock('@/hooks/useOpenLiveCamera', () => ({ useOpenLiveCamera: () => open.fn }))

import { ChatInbox } from './ChatInbox'

const keyFor = (workerId: string): string => ['me', workerId].sort().join('#')

const CONV: Conversation = {
  id: 'me#w1',
  participants: ['me', 'w1'],
  participantNames: ['Eu', 'Romulo Cardoso'],
  participantSubtitles: ['', 'Setor Norte'],
  participantAvatars: ['', ''],
  lastMessageBody: 'Olá admin',
  lastMessageAt: '2026-07-23T10:00:00Z',
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

function setChat(directory: Contact[]) {
  chat.value = {
    myId: 'me',
    loadStatus: 'ready',
    conversations: [CONV],
    messagesByConv: { 'me#w1': [] },
    directory,
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

beforeEach(() => open.fn.mockClear())

describe('ChatInbox: câmera da posição do contato', () => {
  it('procura a transmissão pelo id do funcionário, não pelo id da conversa', async () => {
    setChat([ROMULO])
    await renderPage(<ChatInbox />, ROUTE)
    fireEvent.click(screen.getByRole('button', { name: 'Ver câmera da posição' }))
    expect(open.fn).toHaveBeenCalledWith('w1', 'Romulo Cardoso')
  })

  it('contato fora do diretório vai sem id', async () => {
    setChat([])
    await renderPage(<ChatInbox />, ROUTE)
    fireEvent.click(screen.getByRole('button', { name: 'Ver câmera da posição' }))
    expect(open.fn).toHaveBeenCalledWith(undefined, 'Romulo Cardoso')
  })
})
