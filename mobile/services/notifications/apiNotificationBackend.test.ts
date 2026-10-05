import { apiRequest } from '../api/http'
import { apiNotificationBackend } from './apiNotificationBackend'

jest.mock('../api/http', () => ({ apiRequest: jest.fn() }))
jest.mock('../api/session', () => ({ getUserId: jest.fn(() => 'me') }))
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => 'tok') }))
const on = jest.fn(); const close = jest.fn()
const mockIo = jest.fn((..._a: any[]) => ({ on, close }))
jest.mock('socket.io-client', () => ({ io: (...a: any[]) => mockIo(...a) }))
const mockUnwatch = jest.fn()
const mockWatch = jest.fn((..._a: any[]) => mockUnwatch)
jest.mock('../realtime/connectionStatus', () => ({
  connectionStatus: { watch: (...a: any[]) => mockWatch(...a) },
}))

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('apiNotificationBackend', () => {
  beforeEach(() => { (apiRequest as jest.Mock).mockReset(); mockIo.mockClear(); on.mockClear(); close.mockClear(); mockWatch.mockClear(); mockUnwatch.mockClear() })

  it('myId vem do singleton de sessão', () => { expect(apiNotificationBackend.myId).toBe('me') })

  it('listNotifications → GET /notifications', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([])
    await apiNotificationBackend.listNotifications()
    expect(apiRequest).toHaveBeenCalledWith('/notifications', { auth: true })
  })

  it('markRead → POST /notifications/:id/read', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({})
    await apiNotificationBackend.markRead('n1')
    expect(apiRequest).toHaveBeenCalledWith('/notifications/n1/read', { method: 'POST', auth: true })
  })

  it('markAllRead → POST /notifications/read-all', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({})
    await apiNotificationBackend.markAllRead()
    expect(apiRequest).toHaveBeenCalledWith('/notifications/read-all', { method: 'POST', auth: true })
  })

  it('registerPushToken é no-op (não faz request)', async () => {
    await apiNotificationBackend.registerPushToken('expo-token')
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('subscribe conecta o socket e entrega notification', async () => {
    const cb = jest.fn()
    const unsub = apiNotificationBackend.subscribe(cb)
    await flush()
    expect(mockIo).toHaveBeenCalledTimes(1)
    const handler = on.mock.calls.find((c) => c[0] === 'notification')![1]
    handler({ id: 'n1', domain: 'chat' })
    expect(cb).toHaveBeenCalledWith({ id: 'n1', domain: 'chat' })
    unsub(); expect(close).toHaveBeenCalled()
  })

  // O aviso de sem conexão lê o estado deste socket: a evacuação e as
  // tarefas novas chegam por ele.
  it('subscribe registra o socket no estado da conexão e tira ao sair, antes de fechar', async () => {
    const unsub = apiNotificationBackend.subscribe(jest.fn())
    await flush()
    expect(mockWatch).toHaveBeenCalledTimes(1)
    expect(mockWatch.mock.calls[0][0]).toBe(mockIo.mock.results[0].value)

    unsub()
    expect(mockUnwatch).toHaveBeenCalledTimes(1)
    expect(mockUnwatch.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0])
  })

  it('quem sai antes de o socket abrir não registra nada', async () => {
    const unsub = apiNotificationBackend.subscribe(jest.fn())
    unsub()
    await flush()
    expect(mockIo).not.toHaveBeenCalled()
    expect(mockWatch).not.toHaveBeenCalled()
  })
})
