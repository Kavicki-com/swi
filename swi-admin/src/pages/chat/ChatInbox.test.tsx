// Smoke + wiring tests for ChatInbox.
// - The ChatBubble tests (B1) are pure-component and stay untouched.
// - The wiring tests (B2) mock the ChatProvider so ChatInbox renders against
//   controlled backend-shaped data with spies for openConversation/send, mock
//   useNavigate to observe routing, and mock useDemoToast to observe toasts.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import type { ReactNode } from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { Conversation, Message, Contact } from '@/services/chat/types'
import type { ChatContact, ChatMessage } from '@/services/chats'
import { clearSession, renderPage } from '@/test-utils/renderPage'

// Hoisted holders so the vi.mock factories (hoisted to the top of the module)
// can close over them. beforeEach swaps in a fresh fixture / clears spies.
const chat = vi.hoisted(() => ({ value: null as unknown }))
const nav = vi.hoisted(() => ({ spy: (..._a: unknown[]) => {} }))
const toast = vi.hoisted(() => ({ show: (..._a: unknown[]) => {} }))

vi.mock('@/services/chat/ChatProvider', () => ({
  ChatProvider: ({ children }: { children: ReactNode }) => children,
  useChat: () => chat.value,
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => nav.spy }
})
vi.mock('@/lib/demoToast', () => ({
  useDemoToast: () => ({ show: toast.show }),
  // ChatInbox doesn't render the provider, but keep a passthrough so the
  // module's other exports stay resolvable.
  DemoToastProvider: ({ children }: { children: ReactNode }) => children,
}))

// Stub do maplibre. Sem ele o `lib` fica null em jsdom e o efeito do mini-mapa
// sai cedo, entao o mapa NUNCA e construido e o bug do QA Web #2 fica invisivel
// no teste.
//
// `lib` e uma referencia ESTAVEL de proposito: devolver um objeto novo a cada
// chamada faria o proprio stub invalidar o efeito, e o teste passaria a medir o
// mock em vez do componente.
const maplibre = vi.hoisted(() => {
  const MapCtor = vi.fn(() => ({ remove: vi.fn() }))
  const MarkerCtor = vi.fn(() => ({ setLngLat: () => ({ addTo: () => {} }) }))
  return { MapCtor, MarkerCtor, lib: { Map: MapCtor, Marker: MarkerCtor } }
})
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => maplibre.lib }))

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
// Directory contact whose name does NOT appear in `conversations`, so the
// "Novo Chat" list swap is observable by its name alone.
const DIR: Contact = {
  workerId: 'w9',
  name: 'Beatriz Ramos',
  sector: 'Setor Oeste',
  role: 'Operadora',
  avatarUri: 'blob:av9',
  birthDate: '1992-04-10T00:00:00.000Z',
  bloodType: 'A+',
  allergies: null,
  gender: 'female',
}

let openConversation: ReturnType<typeof vi.fn>
let closeConversation: ReturnType<typeof vi.fn>
let send: ReturnType<typeof vi.fn>

function setChat(over: Record<string, unknown> = {}) {
  openConversation = vi.fn(async () => {})
  closeConversation = vi.fn()
  send = vi.fn(async () => ({ error: null }))
  chat.value = {
    myId: 'me',
    loadStatus: 'ready',
    conversations: [CONV],
    messagesByConv: { 'me#w1': [MSG] },
    directory: [DIR],
    load: vi.fn(async () => {}),
    openConversation,
    closeConversation,
    send,
    keyFor,
    ...over,
  }
}

// A conversation route so useParams resolves the (decoded) selection.
const CONV_ROUTE = { route: '/chat/me%23w1', path: '/chat/:contactId' }

describe('ChatInbox', () => {
  beforeEach(() => {
    setChat()
    nav.spy = vi.fn()
    toast.show = vi.fn()
    maplibre.MapCtor.mockClear()
    maplibre.MarkerCtor.mockClear()
  })
  afterEach(clearSession)

  // QA Web #2 (30/07/2026): "ao digitar no campo de mensagem, o painel do mapa
  // fica piscando repetidamente".
  //
  // O piscar era o mini-mapa sendo DESTRUIDO e RECONSTRUIDO a cada tecla:
  // `contacts` e recalculado inline no render de ChatInbox, entao cada
  // setDraft produzia objetos ChatContact novos, e o efeito do ContactMiniMap
  // dependia do objeto inteiro. Nao era so visual: cada reconstrucao refazia o
  // fetch dos tiles de satelite da ESRI, uma requisicao por tecla.
  it('nao reconstroi o mini-mapa a cada tecla digitada no composer', async () => {
    renderPage(<ChatInbox />, CONV_ROUTE)
    await waitFor(() => expect(maplibre.MapCtor).toHaveBeenCalledTimes(1))

    const input = screen.getByPlaceholderText('Digite aqui sua mensagem') as HTMLInputElement
    for (const value of ['O', 'Ol', 'Olá', 'Olá ', 'Olá t']) {
      fireEvent.change(input, { target: { value } })
    }

    // O mapa foi construido UMA vez, na montagem, e nao uma vez por tecla.
    expect(maplibre.MapCtor).toHaveBeenCalledTimes(1)
  })

  it('renders without crashing', () => {
    expect(() => renderPage(<ChatInbox />, { route: '/chat' })).not.toThrow()
  })

  it('lists the real conversation by contact name', () => {
    renderPage(<ChatInbox />, { route: '/chat' })
    // Name appears in the left contact list.
    expect(screen.getAllByText('Romulo Cardoso').length).toBeGreaterThan(0)
  })

  it('pins the default conversation into the URL when no param is present', async () => {
    renderPage(<ChatInbox />, { route: '/chat' })
    await waitFor(() => expect(nav.spy).toHaveBeenCalledWith('/chat/me%23w1', { replace: true }))
  })

  it('does not pin (and stays empty) when the inbox is empty', () => {
    setChat({ conversations: [], messagesByConv: {}, loadStatus: 'empty' })
    renderPage(<ChatInbox />, { route: '/chat' })
    expect(nav.spy).not.toHaveBeenCalled()
    expect(screen.getByText('Selecione uma conversa para visualizar as mensagens')).toBeTruthy()
  })

  it('shows an error surface (not empty) when the load failed', async () => {
    setChat({ conversations: [], messagesByConv: {}, loadStatus: 'error' })
    renderPage(<ChatInbox />, { route: '/chat' })
    expect(screen.getByText('Não foi possível carregar as conversas.')).toBeTruthy()
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith('Não foi possível carregar as conversas.'),
    )
  })

  it('opens the selected conversation on mount', async () => {
    renderPage(<ChatInbox />, CONV_ROUTE)
    await waitFor(() => expect(openConversation).toHaveBeenCalledWith('me#w1'))
  })

  it('closes the active conversation on unmount (frees openConvRef)', () => {
    const { unmount } = renderPage(<ChatInbox />, CONV_ROUTE)
    expect(closeConversation).not.toHaveBeenCalled()
    unmount()
    expect(closeConversation).toHaveBeenCalledTimes(1)
  })

  it('selecting a conversation navigates with the %23-encoded id', () => {
    renderPage(<ChatInbox />, CONV_ROUTE)
    fireEvent.click(screen.getByLabelText('Conversar com Romulo Cardoso'))
    expect(nav.spy).toHaveBeenCalledWith('/chat/me%23w1')
  })

  it('sends the typed text via the provider without local append', async () => {
    renderPage(<ChatInbox />, CONV_ROUTE)
    const input = screen.getByPlaceholderText('Digite aqui sua mensagem') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Nova mensagem de teste' } })
    fireEvent.click(screen.getByText('Enviar'))
    // Third arg is the optional image File — undefined for a text-only send.
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('me#w1', 'Nova mensagem de teste', undefined),
    )
    // Draft cleared on success; no optimistic bubble for the typed text.
    await waitFor(() => expect(input.value).toBe(''))
    expect(screen.queryByText('Nova mensagem de teste')).toBeNull()
  })

  it('keeps the draft and toasts on a send error', async () => {
    send.mockResolvedValueOnce({ error: { message: 'falhou' } })
    renderPage(<ChatInbox />, CONV_ROUTE)
    const input = screen.getByPlaceholderText('Digite aqui sua mensagem') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Mensagem que falha' } })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith('falhou'))
    expect(input.value).toBe('Mensagem que falha')
  })

  it('does not send when both the draft and the pending image are empty', () => {
    renderPage(<ChatInbox />, CONV_ROUTE)
    fireEvent.click(screen.getByText('Enviar'))
    expect(send).not.toHaveBeenCalled()
  })

  it('the attach button opens the hidden file picker', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    renderPage(<ChatInbox />, CONV_ROUTE)
    fireEvent.click(screen.getByTestId('chat-attach'))
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('shows the attachment preview + remove control after picking a file', () => {
    renderPage(<ChatInbox />, CONV_ROUTE)
    const fileInput = screen.getByTestId('chat-file-input') as HTMLInputElement
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    expect(screen.getByText('foto.jpg')).toBeTruthy()
    expect(screen.getByTestId('chat-attach-remove')).toBeTruthy()
  })

  it('sends the picked image as the third arg to the provider', async () => {
    renderPage(<ChatInbox />, CONV_ROUTE)
    const input = screen.getByPlaceholderText('Digite aqui sua mensagem') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Com foto' } })
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(send).toHaveBeenCalledWith('me#w1', 'Com foto', file))
  })

  it('allows an image-only send (empty draft + a pending image)', async () => {
    renderPage(<ChatInbox />, CONV_ROUTE)
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(send).toHaveBeenCalledWith('me#w1', '', file))
  })

  it('clears the pending image after a successful send', async () => {
    renderPage(<ChatInbox />, CONV_ROUTE)
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(screen.queryByText('foto.jpg')).toBeNull())
  })

  it('keeps the pending image on a send error', async () => {
    send.mockResolvedValueOnce({ error: { message: 'falhou' } })
    renderPage(<ChatInbox />, CONV_ROUTE)
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith('falhou'))
    expect(screen.getByText('foto.jpg')).toBeTruthy()
  })

  it('the remove control clears the pending image', () => {
    renderPage(<ChatInbox />, CONV_ROUTE)
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    expect(screen.getByText('foto.jpg')).toBeTruthy()
    fireEvent.click(screen.getByTestId('chat-attach-remove'))
    expect(screen.queryByText('foto.jpg')).toBeNull()
  })

  it('"Novo Chat" swaps the left list to the directory contacts', () => {
    renderPage(<ChatInbox />, { route: '/chat' })
    expect(screen.queryByText('Beatriz Ramos')).toBeNull()
    fireEvent.click(screen.getByText('Novo Chat'))
    expect(screen.getByText('Beatriz Ramos')).toBeTruthy()
    // Toggle affordance flips to "Cancelar".
    expect(screen.getByText('Cancelar')).toBeTruthy()
  })
})

const CONTACT: ChatContact = {
  id: 'chat-test',
  name: 'Fulano de Tal',
  sector: 'Setor Norte',
  avatarUri: 'blob:avatar',
}

describe('ChatBubble', () => {
  beforeEach(() => {
    setChat()
    nav.spy = vi.fn()
    toast.show = vi.fn()
  })
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

  // QA Web #4 (30/07/2026): o more_vert do balao nao abria nada. Era um <Icon>
  // solto, sem Pressable e sem onPress.
  //
  // Nao virou "menu de acoes" porque nao ha acoes: o backend so tem listar,
  // enviar e marcar como lida. Copiar e a unica real, e agora e o que o
  // controle faz, com rotulo acessivel dizendo isso.
  const TEXT_MESSAGE: ChatMessage = {
    id: 'm-copy',
    text: 'Copie esta mensagem.',
    sender: 'them',
    time: '10:40',
  }

  it('o more_vert deixa de ser controle morto e copia a mensagem (QA Web #4)', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    renderPage(<ChatBubble message={TEXT_MESSAGE} contact={CONTACT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensagem' }))

    expect(writeText).toHaveBeenCalledWith('Copie esta mensagem.')
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith('Mensagem copiada'))
  })

  // Clipboard exige contexto seguro; em http:// simples o navegador nao expoe a
  // API. Cair calado aqui reintroduziria o bug original (clico, nada acontece).
  it('sem clipboard disponivel, avisa em vez de nao fazer nada', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    renderPage(<ChatBubble message={TEXT_MESSAGE} contact={CONTACT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copiar mensagem' }))

    expect(toast.show).toHaveBeenCalledWith('Não foi possível copiar', expect.any(String))
  })
})
