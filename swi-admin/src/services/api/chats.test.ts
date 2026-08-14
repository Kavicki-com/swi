import { vi } from 'vitest'
import { chatsApi } from './chats'

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response)
afterEach(() => vi.unstubAllGlobals())

describe('chatsApi.listConversations', () => {
  it('GET /chat/conversations no envelope', async () => {
    const f = okJson([{ id: 'a#b' }])
    vi.stubGlobal('fetch', f)
    const { data, error } = await chatsApi.listConversations()
    expect(error).toBeNull()
    expect(data![0]!.id).toBe('a#b')
    expect((f.mock.calls[0] as [string])[0]).toContain('/chat/conversations')
  })
})
describe('chatsApi.listDirectory', () => {
  it('GET /chat/directory no envelope', async () => {
    const f = okJson([{ workerId: 'w1' }])
    vi.stubGlobal('fetch', f)
    const { data, error } = await chatsApi.listDirectory()
    expect(error).toBeNull()
    expect(data![0]!.workerId).toBe('w1')
    expect((f.mock.calls[0] as [string])[0]).toContain('/chat/directory')
  })
})
describe('chatsApi.listMessages', () => {
  it('encoda o # do id na URL', async () => {
    const f = okJson([])
    vi.stubGlobal('fetch', f)
    await chatsApi.listMessages('a#b')
    expect((f.mock.calls[0] as [string])[0]).toContain('/chat/conversations/a%23b/messages')
  })
})
describe('chatsApi.sendMessage', () => {
  it('POST body {body,imageKey}', async () => {
    const f = okJson({ id: 'm1' })
    vi.stubGlobal('fetch', f)
    await chatsApi.sendMessage('a#b', { body: 'oi', imageKey: 'chat/x.jpg' })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/chat/conversations/a%23b/messages')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ body: 'oi', imageKey: 'chat/x.jpg' })
  })
})
// Denunciar mensagem. O que vale trancar aqui é o path aninhado com os DOIS
// encodes (o # da conversa e o id da mensagem) e o dto cru.
describe('chatsApi.reportMessage', () => {
  it('POST /report com o path encodado e o dto {reason,text}', async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204, json: async () => null } as Response)
    vi.stubGlobal('fetch', f)
    const { error } = await chatsApi.reportMessage('a#b', 'm1', {
      reason: 'Spam',
      text: 'detalhe',
    })
    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/chat/conversations/a%23b/messages/m1/report')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Spam', text: 'detalhe' })
  })
})
describe('chatsApi.markRead', () => {
  it('POST /read (204 → data null, error null)', async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204, json: async () => null } as Response)
    vi.stubGlobal('fetch', f)
    const { error } = await chatsApi.markRead('a#b')
    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/chat/conversations/a%23b/read')
    expect(init.method).toBe('POST')
  })
})
describe('erro de rede', () => {
  it('→ {data:null, error}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    const { data, error } = await chatsApi.listConversations()
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
    // Trava o invariante do A2: error é um MockError { message } puro, NUNCA o
    // ApiError cru (que carregaria `status`/`name`). Uma regressão pra
    // `error: e as ApiError` vaza essas chaves e faz este teste falhar alto.
    expect(Object.keys(error!)).toEqual(['message'])
    expect('status' in error!).toBe(false)
  })
})
