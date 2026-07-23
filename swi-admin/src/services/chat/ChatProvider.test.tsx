import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

// vi.mock é hoistado pro topo; os mocks têm que existir antes dele — por isso
// vi.hoisted (padrão do repo, ver chatSocket.test.ts / Login.test.tsx). `socket`
// é um holder mutável pra capturar o callback passado a subscribeMessages.
const { listConversations, listDirectory, listMessages, sendMessage, markRead, socket } = vi.hoisted(() => ({
  listConversations: vi.fn(),
  listDirectory: vi.fn(async () => ({ data: [], error: null })),
  listMessages: vi.fn(async () => ({ data: [], error: null })),
  sendMessage: vi.fn(async () => ({ data: null, error: null })),
  markRead: vi.fn(async () => ({ data: null, error: null })),
  socket: { cb: (_m: any) => {} },
}))
vi.mock('../api/chats', () => ({ chatsApi: { listConversations, listDirectory, listMessages, sendMessage, markRead } }))
const socketCb = (m: any) => socket.cb(m)
vi.mock('./chatSocket', () => ({ subscribeMessages: (cb: any) => { socket.cb = cb; return () => {} } }))
vi.mock('../api/upload', () => ({ uploadImage: vi.fn(async () => 'chat/x.jpg') }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))

import { ChatProvider, useChat } from './ChatProvider'

function Probe() {
  const { loadStatus, conversations, send } = useChat()
  return (
    <>
      <span data-testid="status">{loadStatus}</span>
      <span data-testid="count">{conversations.length}</span>
      <button onClick={() => send('me#w1', 'oi')}>send</button>
    </>
  )
}
const setup = () => render(<ChatProvider><Probe /></ChatProvider>)

it('carrega e fica ready com conversas', async () => {
  listConversations.mockResolvedValueOnce({ data: [{ id: 'me#w1', participants: ['me','w1'], participantNames:['Eu','W'], participantSubtitles:['',''], participantAvatars:['',''], lastMessageBody:'', lastMessageAt:null, unreadBy:{} }], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
  expect(screen.getByTestId('count').textContent).toBe('1')
})
it('mensagem do socket de conversa desconhecida → refetch da lista', async () => {
  listConversations.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('empty'))
  listConversations.mockResolvedValueOnce({ data: [{ id: 'me#w2', participants:['me','w2'], participantNames:['Eu','W2'], participantSubtitles:['',''], participantAvatars:['',''], lastMessageBody:'oi', lastMessageAt:'2026-07-23T10:00:00Z', unreadBy:{ me:1 } }], error: null })
  socketCb({ id:'m1', conversationId:'me#w2', participants:['me','w2'], senderId:'w2', body:'oi', imageUri:null, sentAt:'2026-07-23T10:00:00Z' })
  await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'))
})
it('send chama chatsApi.sendMessage', async () => {
  listConversations.mockResolvedValueOnce({ data: [], error: null })
  setup()
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('empty'))
  fireEvent.click(screen.getByText('send'))
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('me#w1', { body: 'oi' }))
})
