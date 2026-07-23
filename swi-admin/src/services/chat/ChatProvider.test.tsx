import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi } from 'vitest'

// vi.mock é hoistado pro topo; os mocks têm que existir antes dele — por isso
// vi.hoisted (padrão do repo, ver chatSocket.test.ts / Login.test.tsx). `socket`
// é um holder mutável pra capturar o callback passado a subscribeMessages.
const { listConversations, listDirectory, listMessages, sendMessage, markRead, uploadImage, socket } =
  vi.hoisted(() => ({
    listConversations: vi.fn(),
    listDirectory: vi.fn(async () => ({ data: [], error: null })),
    listMessages: vi.fn(async () => ({ data: [], error: null })),
    sendMessage: vi.fn(async () => ({ data: null, error: null })),
    markRead: vi.fn(async () => ({ data: null, error: null })),
    uploadImage: vi.fn(async () => 'chat/x.jpg'),
    socket: { cb: (_m: any) => {} },
  }))
vi.mock('../api/chats', () => ({
  chatsApi: { listConversations, listDirectory, listMessages, sendMessage, markRead },
}))
const socketCb = (m: any) => socket.cb(m)
vi.mock('./chatSocket', () => ({
  subscribeMessages: (cb: any) => {
    socket.cb = cb
    return () => {}
  },
}))
vi.mock('../api/upload', () => ({ uploadImage }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))

import { ChatProvider, useChat } from './ChatProvider'

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
    data: [conv('me#w2', { lastMessageBody: 'oi', lastMessageAt: '2026-07-23T10:00:00Z', unreadBy: { me: 1 } })],
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
  listConversations.mockResolvedValueOnce({ data: [conv('me#w1', { unreadBy: { me: 2 } })], error: null })
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
