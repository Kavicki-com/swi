import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi } from 'vitest'

// vi.mock é hoistado pro topo; os mocks têm que existir antes dele — por isso
// vi.hoisted (padrão do repo, ver chatSocket.test.ts / Login.test.tsx). `socket`
// é um holder mutável pra capturar o callback passado a subscribeMessages.
const {
  listConversations,
  listDirectory,
  listMessages,
  sendMessage,
  markRead,
  uploadImage,
  socket,
} = vi.hoisted(() => ({
  listConversations: vi.fn(),
  listDirectory: vi.fn(async () => ({ data: [], error: null })),
  listMessages: vi.fn(
    async (): Promise<{ data: unknown[] | null; error: { message: string } | null }> => ({
      data: [],
      error: null,
    }),
  ),
  sendMessage: vi.fn(async () => ({ data: null, error: null })),
  markRead: vi.fn(async () => ({ data: null, error: null })),
  uploadImage: vi.fn(async () => 'chat/x.jpg'),
  socket: { cb: (_m: unknown) => {} },
}))
vi.mock('../api/chats', () => ({
  chatsApi: { listConversations, listDirectory, listMessages, sendMessage, markRead },
}))
const socketCb = (m: unknown) => socket.cb(m)
vi.mock('./chatSocket', () => ({
  subscribeMessages: (cb: (m: unknown) => void) => {
    socket.cb = cb
    return () => {}
  },
}))
vi.mock('../api/upload', () => ({ uploadImage }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))

import { ChatProvider, useChat } from './ChatProvider'
import { simulateReconnect } from '@/test-utils/simulateReconnect'

// Sem clearMocks no config → limpa histórico entre testes (mantém impls default)
// pra que not.toHaveBeenCalled / toHaveBeenCalledWith não vazem de um teste pro outro.
beforeEach(() => {
  vi.clearAllMocks()
})

// Captura o contexto vivo pra chamar send/openConversation direto (com File, etc.).
let ctx: ReturnType<typeof useChat>
function Probe() {
  ctx = useChat()
  const { loadStatus, conversations, send } = ctx
  return (
    <>
      <span data-testid="status">{loadStatus}</span>
      <span data-testid="count">{conversations.length}</span>
      <button onClick={() => send('me#w1', 'oi')}>send</button>
    </>
  )
}
const setup = () =>
  render(
    <ChatProvider>
      <Probe />
    </ChatProvider>,
  )

const conv = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  participants: id.split('#'),
  participantNames: ['Eu', 'W'],
  participantSubtitles: ['', ''],
  participantAvatars: ['', ''],
  lastMessageBody: '',
  lastMessageAt: null as string | null,
  unreadBy: {} as Record<string, number>,
  ...over,
})

it('carrega e fica ready com conversas', async () => {
  listConversations.mockResolvedValueOnce({ data: [conv('me#w1')], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
  expect(screen.getByTestId('count').textContent).toBe('1')
})

it('erro no carregamento → loadStatus error', async () => {
  listConversations.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
})

it('mensagem do socket de conversa desconhecida → refetch da lista', async () => {
  listConversations.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('empty'))
  listConversations.mockResolvedValueOnce({
    data: [
      conv('me#w2', {
        lastMessageBody: 'oi',
        lastMessageAt: '2026-07-23T10:00:00Z',
        unreadBy: { me: 1 },
      }),
    ],
    error: null,
  })
  act(() =>
    socketCb({
      id: 'm1',
      conversationId: 'me#w2',
      participants: ['me', 'w2'],
      senderId: 'w2',
      body: 'oi',
      imageUri: null,
      sentAt: '2026-07-23T10:00:00Z',
    }),
  )
  await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'))
})

it('mensagem do outro na conversa aberta → markRead automático', async () => {
  listConversations.mockResolvedValueOnce({
    data: [conv('me#w1', { unreadBy: { me: 2 } })],
    error: null,
  })
  listMessages.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
  await act(async () => {
    await ctx.openConversation('me#w1')
  })
  markRead.mockClear() // isola o markRead disparado pelo socket, não o do open
  act(() =>
    socketCb({
      id: 'm2',
      conversationId: 'me#w1',
      participants: ['me', 'w1'],
      senderId: 'w1',
      body: 'oi',
      imageUri: null,
      sentAt: '2026-07-23T11:00:00Z',
    }),
  )
  await waitFor(() => expect(markRead).toHaveBeenCalledWith('me#w1'))
})

it('openConversation em conversa conhecida → listMessages + markRead', async () => {
  listConversations.mockResolvedValueOnce({
    data: [conv('me#w1', { unreadBy: { me: 3 } })],
    error: null,
  })
  listMessages.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
  await act(async () => {
    await ctx.openConversation('me#w1')
  })
  expect(listMessages).toHaveBeenCalledWith('me#w1')
  expect(markRead).toHaveBeenCalledWith('me#w1')
})

it('openConversation em conversa nova (desconhecida) → sem listMessages/markRead, thread []', async () => {
  listConversations.mockResolvedValueOnce({ data: [conv('me#w1')], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
  await act(async () => {
    await ctx.openConversation('me#wNEW')
  })
  // Conversa lazy ainda não existe no backend → nenhum REST 404-prone é disparado.
  expect(listMessages).not.toHaveBeenCalled()
  expect(markRead).not.toHaveBeenCalled()
  // Thread inicializada vazia pro echo do 1º send poder dar append.
  expect(ctx.messagesByConv['me#wNEW']).toEqual([])
})

it('closeConversation → mensagem do outro na conversa antes-aberta NÃO é auto-lida', async () => {
  listConversations.mockResolvedValueOnce({
    data: [conv('me#w1', { unreadBy: {} })],
    error: null,
  })
  listMessages.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
  await act(async () => {
    await ctx.openConversation('me#w1')
  })
  // Admin sai do inbox: libera a conversa ativa.
  act(() => {
    ctx.closeConversation()
  })
  markRead.mockClear() // isola qualquer markRead pós-close
  act(() =>
    socketCb({
      id: 'm2',
      conversationId: 'me#w1',
      participants: ['me', 'w1'],
      senderId: 'w1',
      body: 'oi',
      imageUri: null,
      sentAt: '2026-07-23T11:00:00Z',
    }),
  )
  // openConvRef foi limpo → nada de markRead; o unread INCREMENTA via applyMessage.
  expect(markRead).not.toHaveBeenCalled()
  await waitFor(() => expect(ctx.conversations[0]?.unreadBy.me).toBe(1))
})

it('send chama chatsApi.sendMessage', async () => {
  listConversations.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('empty'))
  fireEvent.click(screen.getByText('send'))
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('me#w1', { body: 'oi' }))
})

it('send com File → sobe imagem e manda imageKey', async () => {
  listConversations.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('empty'))
  const file = new File([''], 'a.jpg', { type: 'image/jpeg' })
  await act(async () => {
    await ctx.send('me#w1', 'oi', file)
  })
  expect(uploadImage).toHaveBeenCalledWith(file, 'chat')
  expect(sendMessage).toHaveBeenCalledWith('me#w1', { body: 'oi', imageKey: 'chat/x.jpg' })
})

it('send com File: upload que lança → resolve { error }, sem rejeição', async () => {
  listConversations.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('empty'))
  uploadImage.mockRejectedValueOnce(new Error('boom'))
  const file = new File([''], 'a.jpg', { type: 'image/jpeg' })
  let result: { error: { message: string } | null } | undefined
  await act(async () => {
    result = await ctx.send('me#w1', 'oi', file)
  })
  expect(result).toEqual({ error: { message: 'boom' } })
  expect(sendMessage).not.toHaveBeenCalled()
})

describe('volta da conexão', () => {
  const msg = (id: string) => ({
    id,
    conversationId: 'me#w1',
    participants: ['me', 'w1'],
    senderId: 'w1',
    body: id,
    imageUri: null,
    sentAt: '2026-10-05T12:00:00.000Z',
  })

  it('relê as conversas sem passar por "carregando"', async () => {
    listConversations.mockResolvedValueOnce({ data: [conv('me#w1')], error: null })
    setup()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))

    listConversations.mockResolvedValueOnce({
      data: [conv('me#w1'), conv('me#w2')],
      error: null,
    })
    act(() => simulateReconnect())
    expect(screen.getByTestId('status').textContent).toBe('ready')

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'))
    expect(screen.getByTestId('status').textContent).toBe('ready')
  })

  it('carga que falhou ao abrir se recupera quando a conexão volta', async () => {
    listConversations.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    setup()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))

    listConversations.mockResolvedValueOnce({ data: [conv('me#w1')], error: null })
    act(() => simulateReconnect())

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('falha na releitura mantém as conversas na tela', async () => {
    listConversations.mockResolvedValueOnce({ data: [conv('me#w1')], error: null })
    setup()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))

    listConversations.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    await act(async () => simulateReconnect())

    expect(listConversations).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('relê as mensagens da conversa aberta e marca como lidas', async () => {
    listConversations.mockResolvedValue({ data: [conv('me#w1')], error: null })
    setup()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    listMessages.mockResolvedValueOnce({ data: [msg('m1')], error: null })
    await act(async () => {
      await ctx.openConversation('me#w1')
    })
    markRead.mockClear()

    listMessages.mockResolvedValueOnce({ data: [msg('m1'), msg('m2')], error: null })
    act(() => simulateReconnect())

    await waitFor(() => expect(ctx.messagesByConv['me#w1']).toHaveLength(2))
    expect(markRead).toHaveBeenCalledWith('me#w1')
  })

  it('falha ao reler a conversa aberta não apaga as mensagens que estão na tela', async () => {
    listConversations.mockResolvedValue({ data: [conv('me#w1')], error: null })
    setup()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    listMessages.mockResolvedValueOnce({ data: [msg('m1')], error: null })
    await act(async () => {
      await ctx.openConversation('me#w1')
    })

    listMessages.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    await act(async () => simulateReconnect())

    expect(listMessages).toHaveBeenCalledTimes(2)
    expect(ctx.messagesByConv['me#w1']).toHaveLength(1)
  })

  it('mensagem que chega pelo socket enquanto a releitura vem não some da conversa aberta', async () => {
    listConversations.mockResolvedValue({ data: [conv('me#w1')], error: null })
    setup()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    listMessages.mockResolvedValueOnce({ data: [msg('m1')], error: null })
    await act(async () => {
      await ctx.openConversation('me#w1')
    })

    let resolveLate!: (v: { data: unknown[]; error: null }) => void
    listMessages.mockReturnValueOnce(new Promise((r) => (resolveLate = r)))
    act(() => simulateReconnect())
    await waitFor(() => expect(listMessages).toHaveBeenCalledTimes(2))
    act(() => socketCb({ ...msg('m2'), sentAt: '2026-10-05T12:01:00.000Z' }))

    await act(async () => resolveLate({ data: [msg('m1')], error: null }))
    expect(ctx.messagesByConv['me#w1']?.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('sem conversa aberta, a volta não relê mensagens', async () => {
    listConversations.mockResolvedValue({ data: [conv('me#w1')], error: null })
    setup()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))

    await act(async () => simulateReconnect())
    expect(listMessages).not.toHaveBeenCalled()
  })
})
