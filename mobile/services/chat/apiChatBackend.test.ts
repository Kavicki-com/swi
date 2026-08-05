import { apiRequest } from '../api/http'
import { uploadImage } from '../api/uploadMedia'
import { apiChatBackend } from './apiChatBackend'

jest.mock('../api/http', () => ({ apiRequest: jest.fn() }))
jest.mock('../api/uploadMedia', () => ({ uploadImage: jest.fn() }))
jest.mock('../api/session', () => ({ getUserId: jest.fn(() => 'me') }))
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => 'tok') }))
const on = jest.fn(); const close = jest.fn()
const mockIo = jest.fn((..._a: any[]) => ({ on, close }))
jest.mock('socket.io-client', () => ({ io: (...a: any[]) => mockIo(...a) }))

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('apiChatBackend', () => {
  beforeEach(() => { (apiRequest as jest.Mock).mockReset(); (uploadImage as jest.Mock).mockReset(); mockIo.mockClear(); on.mockClear(); close.mockClear() })

  it('myId vem do singleton de sessão', () => { expect(apiChatBackend.myId).toBe('me') })

  it('listConversations → GET /chat/conversations', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([{ id: 'a#b' }])
    await apiChatBackend.listConversations()
    expect(apiRequest).toHaveBeenCalledWith('/chat/conversations', { auth: true })
  })

  it('listMessages → GET encodado (# vira %23)', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([])
    await apiChatBackend.listMessages('a#b')
    expect(apiRequest).toHaveBeenCalledWith('/chat/conversations/a%23b/messages', { auth: true })
  })

  it('listDirectory → GET /chat/directory', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([])
    await apiChatBackend.listDirectory()
    expect(apiRequest).toHaveBeenCalledWith('/chat/directory', { auth: true })
  })

  it('sendMessage sem imagem → POST body (path encodado)', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'm1' })
    await apiChatBackend.sendMessage('a#b', 'oi')
    expect(apiRequest).toHaveBeenCalledWith('/chat/conversations/a%23b/messages', { method: 'POST', body: { body: 'oi' }, auth: true })
  })

  it('sendMessage com imagem sobe (prefixo chat) e manda a key', async () => {
    (uploadImage as jest.Mock).mockResolvedValue('chat/k.jpg')
    ;(apiRequest as jest.Mock).mockResolvedValue({ id: 'm1' })
    await apiChatBackend.sendMessage('a#b', '', 'file:///x.jpg')
    expect(uploadImage).toHaveBeenCalledWith('file:///x.jpg', 'chat')
    expect(apiRequest).toHaveBeenCalledWith('/chat/conversations/a%23b/messages', { method: 'POST', body: { body: '', imageKey: 'chat/k.jpg' }, auth: true })
  })

  it('markRead → POST /read (path encodado)', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({})
    await apiChatBackend.markRead('a#b')
    expect(apiRequest).toHaveBeenCalledWith('/chat/conversations/a%23b/read', { method: 'POST', auth: true })
  })

  it('subscribe conecta o socket e entrega só as msgs do filtro', async () => {
    const cb = jest.fn()
    const unsub = apiChatBackend.subscribe(null, cb)
    await flush()
    expect(mockIo).toHaveBeenCalledTimes(1)
    const handler = on.mock.calls.find((c) => c[0] === 'message')![1]
    handler({ conversationId: 'a#b', body: 'x' })
    expect(cb).toHaveBeenCalledWith({ conversationId: 'a#b', body: 'x' })
    unsub(); expect(close).toHaveBeenCalled()
  })

  it('subscribe(convId) filtra outras conversas', async () => {
    const cb = jest.fn()
    apiChatBackend.subscribe('a#b', cb)
    await flush()
    const handler = on.mock.calls.find((c) => c[0] === 'message')![1]
    handler({ conversationId: 'OUTRA', body: 'y' })
    expect(cb).not.toHaveBeenCalled()
    handler({ conversationId: 'a#b', body: 'z' })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
