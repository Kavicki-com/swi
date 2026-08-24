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
// sai cedo, entao o mapa NUNCA e construido e o teste de reconstrucao do
// mini-mapa passa sem medir nada.
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

import { ChatInbox } from './ChatInbox'
import { ChatBubble } from './components/ChatBubble'

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
let editMessage: ReturnType<typeof vi.fn>
let deleteMessage: ReturnType<typeof vi.fn>

function setChat(over: Record<string, unknown> = {}) {
  openConversation = vi.fn(async () => {})
  closeConversation = vi.fn()
  send = vi.fn(async () => ({ error: null }))
  editMessage = vi.fn(async () => ({ error: null }))
  deleteMessage = vi.fn(async () => ({ error: null }))
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
    editMessage,
    deleteMessage,
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

  // `contacts` e recalculado inline no render de ChatInbox, entao cada
  // setDraft do composer produz objetos ChatContact novos. Se o efeito do
  // mini-mapa depender do objeto inteiro, o mapa e DESTRUIDO e RECONSTRUIDO a
  // cada tecla: o painel pisca e cada reconstrucao refaz o fetch dos tiles de
  // satelite da ESRI, uma requisicao por tecla.
  it('nao reconstroi o mini-mapa a cada tecla digitada no composer', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
    await waitFor(() => expect(maplibre.MapCtor).toHaveBeenCalledTimes(1))

    const input = screen.getByPlaceholderText('Digite aqui sua mensagem') as HTMLInputElement
    for (const value of ['O', 'Ol', 'Olá', 'Olá ', 'Olá t']) {
      fireEvent.change(input, { target: { value } })
    }

    // O mapa foi construido UMA vez, na montagem, e nao uma vez por tecla.
    expect(maplibre.MapCtor).toHaveBeenCalledTimes(1)
  })

  it('renders without crashing', async () => {
    await expect(renderPage(<ChatInbox />, { route: '/chat' })).resolves.toBeDefined()
  })

  // O painel declarava "Masculino" pra todo contato que não fosse 'female',
  // inclusive quem não tem cadastro clínico nenhum (é o caso do 'w1' desta
  // fixture: ele não está no `directory`). Declarar o gênero errado de alguém é
  // pior do que admitir que o dado não veio.
  it('não declara gênero de quem não tem o campo cadastrado', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
    expect(screen.getByText('Gênero')).toBeInTheDocument()
    expect(screen.getByText('Não informado')).toBeInTheDocument()
    expect(screen.queryByText('Masculino')).not.toBeInTheDocument()
  })

  it('lists the real conversation by contact name', async () => {
    await renderPage(<ChatInbox />, { route: '/chat' })
    // Name appears in the left contact list.
    expect(screen.getAllByText('Romulo Cardoso').length).toBeGreaterThan(0)
  })

  it('pins the default conversation into the URL when no param is present', async () => {
    await renderPage(<ChatInbox />, { route: '/chat' })
    await waitFor(() => expect(nav.spy).toHaveBeenCalledWith('/chat/me%23w1', { replace: true }))
  })

  it('does not pin (and stays empty) when the inbox is empty', async () => {
    setChat({ conversations: [], messagesByConv: {}, loadStatus: 'empty' })
    await renderPage(<ChatInbox />, { route: '/chat' })
    expect(nav.spy).not.toHaveBeenCalled()
    expect(screen.getByText('Selecione uma conversa para visualizar as mensagens')).toBeTruthy()
  })

  it('shows an error surface (not empty) when the load failed', async () => {
    setChat({ conversations: [], messagesByConv: {}, loadStatus: 'error' })
    await renderPage(<ChatInbox />, { route: '/chat' })
    expect(screen.getByText('Não foi possível carregar as conversas.')).toBeTruthy()
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith('Não foi possível carregar as conversas.'),
    )
  })

  it('opens the selected conversation on mount', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
    await waitFor(() => expect(openConversation).toHaveBeenCalledWith('me#w1'))
  })

  it('closes the active conversation on unmount (frees openConvRef)', async () => {
    const { unmount } = await renderPage(<ChatInbox />, CONV_ROUTE)
    expect(closeConversation).not.toHaveBeenCalled()
    unmount()
    expect(closeConversation).toHaveBeenCalledTimes(1)
  })

  it('selecting a conversation navigates with the %23-encoded id', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
    fireEvent.click(screen.getByLabelText('Conversar com Romulo Cardoso'))
    expect(nav.spy).toHaveBeenCalledWith('/chat/me%23w1')
  })

  it('sends the typed text via the provider without local append', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
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
    await renderPage(<ChatInbox />, CONV_ROUTE)
    const input = screen.getByPlaceholderText('Digite aqui sua mensagem') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Mensagem que falha' } })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith('falhou'))
    expect(input.value).toBe('Mensagem que falha')
  })

  // Editar acontece no campo de mensagem, nao numa caixa separada: e o mesmo
  // gesto de escrever, e o texto antigo precisa estar ali pra ser corrigido.
  // Fixture propria porque a MSG padrao e do outro participante, e mensagem do
  // outro nao oferece editar.
  const MY_MSG: Message = { ...MSG, id: 'm-mine', senderId: 'me', body: 'Texto original' }

  it('editar carrega a mensagem no campo e troca o CTA para salvar', async () => {
    setChat({ messagesByConv: { 'me#w1': [MY_MSG] } })
    await renderPage(<ChatInbox />, CONV_ROUTE)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }))

    const input = screen.getByPlaceholderText('Digite aqui sua mensagem') as HTMLInputElement
    expect(input.value).toBe('Texto original')
    expect(screen.getByText('Salvar')).toBeTruthy()
  })

  it('salvar a edicao chama editMessage e volta ao modo normal', async () => {
    setChat({ messagesByConv: { 'me#w1': [MY_MSG] } })
    await renderPage(<ChatInbox />, CONV_ROUTE)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }))
    const input = screen.getByPlaceholderText('Digite aqui sua mensagem') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Texto corrigido' } })
    fireEvent.click(screen.getByText('Salvar'))

    await waitFor(() =>
      expect(editMessage).toHaveBeenCalledWith('me#w1', 'm-mine', 'Texto corrigido'),
    )
    await waitFor(() => expect(screen.getByText('Enviar')).toBeTruthy())
    expect(input.value).toBe('')
    expect(send).not.toHaveBeenCalled()
  })

  // Sem saida explicita, quem entra na edicao por engano fica preso: o CTA nao
  // envia mais, e apagar o texto nao devolve o modo normal.
  it('cancelar a edicao limpa o campo e devolve o CTA de enviar', async () => {
    setChat({ messagesByConv: { 'me#w1': [MY_MSG] } })
    await renderPage(<ChatInbox />, CONV_ROUTE)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }))
    fireEvent.click(screen.getByLabelText('Cancelar edição'))

    const input = screen.getByPlaceholderText('Digite aqui sua mensagem') as HTMLInputElement
    expect(input.value).toBe('')
    expect(screen.getByText('Enviar')).toBeTruthy()
    expect(editMessage).not.toHaveBeenCalled()
  })

  // O form de denúncia abre num modal da página, como o SupportModal. Montado
  // dentro da bolha ele seria recortado pelo overflowX hidden do quadro de
  // mensagens.
  it('denunciar pela bolha abre o modal de denúncia', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Denunciar' }))

    expect(screen.getByText('Denunciar mensagem')).toBeTruthy()
  })

  it('does not send when both the draft and the pending image are empty', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
    fireEvent.click(screen.getByText('Enviar'))
    expect(send).not.toHaveBeenCalled()
  })

  it('the attach button opens the hidden file picker', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    await renderPage(<ChatInbox />, CONV_ROUTE)
    fireEvent.click(screen.getByTestId('chat-attach'))
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('shows the attachment preview + remove control after picking a file', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
    const fileInput = screen.getByTestId('chat-file-input') as HTMLInputElement
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    expect(screen.getByText('foto.jpg')).toBeTruthy()
    expect(screen.getByTestId('chat-attach-remove')).toBeTruthy()
  })

  it('sends the picked image as the third arg to the provider', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
    const input = screen.getByPlaceholderText('Digite aqui sua mensagem') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Com foto' } })
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(send).toHaveBeenCalledWith('me#w1', 'Com foto', file))
  })

  it('allows an image-only send (empty draft + a pending image)', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(send).toHaveBeenCalledWith('me#w1', '', file))
  })

  it('clears the pending image after a successful send', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(screen.queryByText('foto.jpg')).toBeNull())
  })

  it('keeps the pending image on a send error', async () => {
    send.mockResolvedValueOnce({ error: { message: 'falhou' } })
    await renderPage(<ChatInbox />, CONV_ROUTE)
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith('falhou'))
    expect(screen.getByText('foto.jpg')).toBeTruthy()
  })

  it('the remove control clears the pending image', async () => {
    await renderPage(<ChatInbox />, CONV_ROUTE)
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    expect(screen.getByText('foto.jpg')).toBeTruthy()
    fireEvent.click(screen.getByTestId('chat-attach-remove'))
    expect(screen.queryByText('foto.jpg')).toBeNull()
  })

  it('"Novo Chat" swaps the left list to the directory contacts', async () => {
    await renderPage(<ChatInbox />, { route: '/chat' })
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

  it('renders the image attachment when the message has an imageUri', async () => {
    const message: ChatMessage = {
      id: 'm-img',
      text: '',
      sender: 'them',
      time: '10:30',
      imageUri: 'blob:some-attachment',
    }
    await renderPage(<ChatBubble message={message} contact={CONTACT} />)
    expect(screen.getByTestId('chat-bubble-image')).toBeTruthy()
  })

  // A bolha PRECISOU perder o `overflow: hidden` para o painel do Popover nao
  // ser recortado (ele e absoluto dentro dela). O anexo so continua com o canto
  // arredondado porque tem wrapper proprio. Este teste tranca as duas metades:
  // se alguem devolver o overflow a bolha, o popover quebra; se alguem tirar o
  // wrapper, a foto vaza o raio. Nenhuma das duas aparece em teste de texto.
  //
  // O react-native-web nunca emite os atalhos: `overflow` sai como
  // overflow-x/overflow-y e o raio sai nos quatro cantos. Procurar por
  // `style.overflow` devolve string vazia mesmo quando o recorte existe.
  const IMAGE_MESSAGE: ChatMessage = {
    id: 'm-img-clip',
    text: '',
    sender: 'me',
    time: '10:33',
    imageUri: 'blob:some-attachment',
  }

  it('o anexo tem recorte proprio no raio', async () => {
    await renderPage(<ChatBubble message={IMAGE_MESSAGE} contact={CONTACT} />)

    const wrapper = screen.getByTestId('chat-bubble-image').parentElement as HTMLElement
    expect(wrapper.style.overflowX).toBe('hidden')
    expect(wrapper.style.borderTopLeftRadius).not.toBe('')
  })

  // Copiar uma mensagem sem texto copiaria o que? Oferecer o item seria expor
  // um controle que existe e nao faz nada. Editar cai junto porque o backend
  // recusa corpo vazio.
  it('mensagem so com imagem nao oferece copiar nem editar', async () => {
    await renderPage(<ChatBubble message={IMAGE_MESSAGE} contact={CONTACT} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))

    expect(screen.queryByRole('menuitem', { name: 'Copiar' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Excluir' })).toBeTruthy()
  })

  it('a bolha nao recorta, senao o painel do popover sumiria', async () => {
    await renderPage(<ChatBubble message={IMAGE_MESSAGE} contact={CONTACT} />)

    const bubble = screen.getByTestId('chat-bubble') as HTMLElement
    expect(bubble.style.borderRadius).not.toBe('')
    expect(bubble.style.overflowX).toBe('')
    expect(bubble.style.overflow).toBe('')
  })

  it('does not render an image box for a text-only message', async () => {
    const message: ChatMessage = {
      id: 'm-text-only',
      text: 'Sem anexo aqui.',
      sender: 'them',
      time: '10:32',
    }
    await renderPage(<ChatBubble message={message} contact={CONTACT} />)
    expect(screen.queryByTestId('chat-bubble-image')).toBeNull()
    expect(screen.getByText('Sem anexo aqui.')).toBeTruthy()
  })

  it('renders both the image and the text when the message has both', async () => {
    const message: ChatMessage = {
      id: 'm-img-text',
      text: 'Segue a foto do sensor.',
      sender: 'me',
      time: '10:31',
      imageUri: 'blob:some-attachment',
    }
    await renderPage(<ChatBubble message={message} contact={CONTACT} />)
    expect(screen.getByTestId('chat-bubble-image')).toBeTruthy()
    expect(screen.getByText('Segue a foto do sensor.')).toBeTruthy()
  })

  const TEXT_MESSAGE: ChatMessage = {
    id: 'm-copy',
    text: 'Copie esta mensagem.',
    sender: 'them',
    time: '10:40',
  }

  // ATUALIZADO em 31/07/2026: copiar deixou de ser a acao do proprio gatilho e
  // virou item do menu. O contrato antigo ("clicar no more_vert copia") foi
  // substituido por decisao do usuario, entao estes dois testes mudam de
  // caminho, nao de exigencia: copiar continua tendo que copiar e continua
  // tendo que avisar quando nao da.
  it('copiar pelo menu copia a mensagem (QA Web #4)', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await renderPage(<ChatBubble message={TEXT_MESSAGE} contact={CONTACT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar' }))

    expect(writeText).toHaveBeenCalledWith('Copie esta mensagem.')
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith('Mensagem copiada'))
  })

  // Editar e excluir existem de ponta a ponta (rotas PATCH/DELETE no backend,
  // editMessage/deleteMessage no ChatProvider), mas so o autor pode usa-las.
  // Na mensagem do outro sobra copiar, e por isso o menu dela e menor, nao
  // desabilitado.
  const MY_MESSAGE: ChatMessage = {
    id: 'm-mine',
    text: 'Minha mensagem.',
    sender: 'me',
    time: '10:41',
  }

  it('o menu da minha mensagem oferece editar, copiar e excluir, sem denunciar', async () => {
    await renderPage(<ChatBubble message={MY_MESSAGE} contact={CONTACT} onReport={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))

    expect(screen.getByRole('menuitem', { name: 'Editar' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copiar' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Excluir' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Denunciar' })).toBeNull()
  })

  // A confirmacao mora DENTRO do painel, por decisao do usuario: o menu troca
  // de conteudo em vez de abrir modal por cima. Excluir mensagem nao merece
  // segunda camada, e o modal roubaria o contexto de qual bolha e.
  it('excluir pede confirmacao no proprio painel antes de chamar o backend', async () => {
    await renderPage(<ChatBubble message={MY_MESSAGE} contact={CONTACT} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }))

    expect(deleteMessage).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: 'Confirmar exclusão' })).toBeTruthy()
  })

  it('confirmar exclusao chama deleteMessage com a conversa e a mensagem', async () => {
    await renderPage(<ChatBubble message={MY_MESSAGE} contact={CONTACT} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Confirmar exclusão' }))

    await waitFor(() => expect(deleteMessage).toHaveBeenCalledWith('chat-test', 'm-mine'))
  })

  // Reabrir o menu depois de desistir tem que voltar ao estado normal, senao a
  // proxima abertura ja comeca com o dedo em cima do botao destrutivo.
  it('desistir volta o painel para as acoes normais', async () => {
    await renderPage(<ChatBubble message={MY_MESSAGE} contact={CONTACT} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancelar' }))

    expect(screen.getByRole('menuitem', { name: 'Editar' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Confirmar exclusão' })).toBeNull()
    expect(deleteMessage).not.toHaveBeenCalled()
  })

  // Excluir deixa marca, por decisao do usuario: a bolha continua na conversa
  // como lapide. O backend ja para de devolver o body, entao a tela nao pode
  // depender do texto pra saber que foi excluida.
  const DELETED_MESSAGE: ChatMessage = {
    id: 'm-del',
    text: '',
    sender: 'me',
    time: '10:42',
    deleted: true,
  }

  it('mensagem excluida vira lapide no lugar do texto', async () => {
    await renderPage(<ChatBubble message={DELETED_MESSAGE} contact={CONTACT} />)

    expect(screen.getByText('Mensagem excluída')).toBeTruthy()
  })

  // Sem isso o menu abriria oferecendo editar e excluir uma mensagem que ja
  // nao existe, e a segunda exclusao bateria no backend a toa.
  it('na mensagem excluida o menu nao abre', async () => {
    await renderPage(<ChatBubble message={DELETED_MESSAGE} contact={CONTACT} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))

    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('mensagem editada ganha a marca "editada"', async () => {
    const edited: ChatMessage = { ...MY_MESSAGE, id: 'm-ed', edited: true }
    await renderPage(<ChatBubble message={edited} contact={CONTACT} />)

    expect(screen.getByText('editada')).toBeTruthy()
  })

  // O react-native-web poe `position: relative; z-index: 0` em TODA View, entao
  // cada bolha e um contexto de empilhamento proprio e as bolhas seguintes
  // pintam por cima do painel da anterior. Visto no navegador em 31/07/2026: os
  // icones de Copiar e Excluir ficavam tapados pela mensagem de baixo. O
  // z-index 100 que o painel tem por dentro nao resolve, porque so vale dentro
  // do contexto da propria bolha.
  it('a bolha sobe na pilha enquanto o menu esta aberto', async () => {
    await renderPage(<ChatBubble message={MY_MESSAGE} contact={CONTACT} />)
    const linha = screen.getByTestId('chat-bubble-row') as HTMLElement
    expect(linha.style.zIndex).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))

    expect(Number(linha.style.zIndex)).toBeGreaterThan(0)
  })

  // Subir a bolha inteira resolveu a mensagem SEGUINTE tapando o painel, mas
  // nao os irmaos DENTRO da bolha: o texto da mensagem e o rodape com "editada"
  // e a hora vem depois do gatilho na ordem do DOM, sao z-index 0 posicionados,
  // e pintavam por cima do painel de confirmacao. Visto no navegador em
  // 31/07/2026. Sao duas disputas distintas, entao dois testes.
  it('o gatilho sobe dentro da linha enquanto o menu esta aberto', async () => {
    await renderPage(<ChatBubble message={MY_MESSAGE} contact={CONTACT} />)
    const ancora = screen.getByTestId('chat-bubble-menu-anchor') as HTMLElement
    expect(ancora.style.zIndex).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))

    expect(Number(ancora.style.zIndex)).toBeGreaterThan(0)
  })

  it('a linha que hospeda o menu sobe acima do rodape', async () => {
    await renderPage(<ChatBubble message={MY_MESSAGE} contact={CONTACT} />)
    const linha = screen.getByTestId('chat-bubble-line') as HTMLElement
    expect(linha.style.zIndex).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))

    expect(Number(linha.style.zIndex)).toBeGreaterThan(0)
  })

  // O painel cresce para o lado OPOSTO ao que a bolha encosta, nao para o lado
  // onde os pontinhos moram. Minha mensagem cola na borda direita da caixa do
  // chat, que tem overflowX hidden: crescer para a direita corta o painel.
  // Foi exatamente o que apareceu no navegador em 31/07/2026.
  it('na minha mensagem o painel cresce para a esquerda', async () => {
    await renderPage(<ChatBubble message={MY_MESSAGE} contact={CONTACT} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))

    const panel = screen.getByTestId('chat-bubble-menu-panel')
    expect(panel.style.right).toBe('0px')
    expect(panel.style.left).toBe('')
  })

  it('na mensagem do outro o painel cresce para a direita', async () => {
    await renderPage(<ChatBubble message={TEXT_MESSAGE} contact={CONTACT} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))

    const panel = screen.getByTestId('chat-bubble-menu-panel')
    expect(panel.style.left).toBe('0px')
    expect(panel.style.right).toBe('')
  })

  // Na mensagem do OUTRO entra "Denunciar" ao lado de copiar. Na minha não: o
  // backend recusa denunciar a própria mensagem, e oferecer o item deixaria no
  // menu um controle que não faz nada.
  it('o menu da mensagem do outro oferece copiar e denunciar', async () => {
    await renderPage(<ChatBubble message={TEXT_MESSAGE} contact={CONTACT} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))

    expect(screen.getByRole('menuitem', { name: 'Copiar' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Denunciar' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Excluir' })).toBeNull()
  })

  // O form mora num modal da página (mesmo padrão do onEdit): a bolha só avisa
  // QUAL mensagem está sendo denunciada e fecha o menu.
  it('denunciar avisa a página com a mensagem e fecha o menu', async () => {
    const onReport = vi.fn()
    await renderPage(<ChatBubble message={TEXT_MESSAGE} contact={CONTACT} onReport={onReport} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Denunciar' }))

    expect(onReport).toHaveBeenCalledWith(TEXT_MESSAGE)
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  // Denunciar vale pra mensagem só de imagem também: o conteúdo ofensivo pode
  // ser a foto. Só texto é exigência do copiar, não do denunciar.
  it('mensagem do outro so com imagem oferece denunciar', async () => {
    const theirImage: ChatMessage = { ...IMAGE_MESSAGE, id: 'm-img-them', sender: 'them' }
    await renderPage(<ChatBubble message={theirImage} contact={CONTACT} onReport={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))

    expect(screen.getByRole('menuitem', { name: 'Denunciar' })).toBeTruthy()
  })

  // Clipboard exige contexto seguro; em http:// simples o navegador nao expoe a
  // API. Cair calado aqui deixaria o clique sem resposta nenhuma.
  it('sem clipboard disponivel, avisa em vez de nao fazer nada', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    await renderPage(<ChatBubble message={TEXT_MESSAGE} contact={CONTACT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar' }))

    expect(toast.show).toHaveBeenCalledWith('Não foi possível copiar', expect.any(String))
  })
})
