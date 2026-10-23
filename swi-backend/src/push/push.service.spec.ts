import { Logger } from '@nestjs/common'
import { EXPO_PUSH_URL, PushService, type PushContent } from './push.service'

// Envio pelo serviço da Expo. O transporte é sempre simulado: nenhum teste
// fala com a Expo de verdade.
const prisma = () => ({
  pushToken: {
    upsert: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
  },
}) as any

const okResponse = (data: unknown[]) => ({ ok: true, status: 200, json: () => Promise.resolve({ data }) })
const transport = () => jest.fn().mockImplementation((_url: string, messages: unknown[]) =>
  Promise.resolve(okResponse(messages.map(() => ({ status: 'ok', id: 'r' })))))

const tokenOf = (i: number) => `ExponentPushToken[t${i}]`
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ token: tokenOf(i) }))

const STARTED: PushContent = {
  title: 'Evacuação iniciada',
  body: 'Abra o app.',
  data: { type: 'evacuation.started', evacuationId: 'ev1' },
  priority: 'high',
  channelId: 'evacuation',
  sound: 'default',
}
const ENDED: PushContent = {
  data: { type: 'evacuation.ended', evacuationId: 'ev1' },
  priority: 'high',
  contentAvailable: true,
}

describe('PushService: tokens do aparelho', () => {
  it('registrar faz upsert pelo token: o aparelho que troca de conta passa a ser da conta nova', async () => {
    const db = prisma()
    await new PushService(db, transport()).register('u2', 'ExpoPushToken[a]', 'ios')
    expect(db.pushToken.upsert).toHaveBeenCalledWith({
      where: { token: 'ExpoPushToken[a]' },
      create: { userId: 'u2', token: 'ExpoPushToken[a]', platform: 'ios' },
      update: { userId: 'u2', platform: 'ios' },
    })
  })

  it('remover só apaga o token do próprio usuário', async () => {
    const db = prisma()
    await new PushService(db, transport()).unregister('u1', 'ExpoPushToken[a]')
    expect(db.pushToken.deleteMany).toHaveBeenCalledWith({ where: { token: 'ExpoPushToken[a]', userId: 'u1' } })
  })
})

describe('PushService.sendToUsers', () => {
  const saved = { PUSH_ENABLED: process.env.PUSH_ENABLED, EXPO_ACCESS_TOKEN: process.env.EXPO_ACCESS_TOKEN }
  let warn: jest.SpyInstance

  beforeEach(() => {
    process.env.PUSH_ENABLED = '1'
    delete process.env.EXPO_ACCESS_TOKEN
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    warn.mockRestore()
  })

  it('desligado (padrão em teste): não consulta tokens nem chama a Expo', async () => {
    delete process.env.PUSH_ENABLED
    const db = prisma()
    const send = transport()
    await new PushService(db, send).sendToUsers(['u1'], STARTED)
    expect(db.pushToken.findMany).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('sem destinatário ou sem token: não chama a Expo', async () => {
    const db = prisma()
    const send = transport()
    const svc = new PushService(db, send)
    await svc.sendToUsers([], STARTED)
    expect(db.pushToken.findMany).not.toHaveBeenCalled()
    await svc.sendToUsers(['u1'], STARTED)
    expect(db.pushToken.findMany).toHaveBeenCalledWith({ where: { userId: { in: ['u1'] } }, select: { token: true } })
    expect(send).not.toHaveBeenCalled()
  })

  it('monta a mensagem com título, corpo, som, prioridade, canal e data, sem Authorization', async () => {
    const db = prisma()
    db.pushToken.findMany.mockResolvedValue(rows(2))
    const send = transport()
    await new PushService(db, send).sendToUsers(['u1', 'u2'], STARTED)
    expect(send).toHaveBeenCalledTimes(1)
    const [url, messages, headers] = send.mock.calls[0]
    expect(url).toBe(EXPO_PUSH_URL)
    expect(messages).toEqual([0, 1].map((i) => ({
      to: tokenOf(i),
      title: 'Evacuação iniciada',
      body: 'Abra o app.',
      sound: 'default',
      priority: 'high',
      channelId: 'evacuation',
      data: { type: 'evacuation.started', evacuationId: 'ev1' },
    })))
    expect(headers).toEqual({})
  })

  it('só de dados: sem título nem corpo, com _contentAvailable para acordar o app no iOS', async () => {
    const db = prisma()
    db.pushToken.findMany.mockResolvedValue(rows(1))
    const send = transport()
    await new PushService(db, send).sendToUsers(['u1'], ENDED)
    const [message] = send.mock.calls[0][1]
    expect(message).toEqual({
      to: tokenOf(0),
      priority: 'high',
      data: { type: 'evacuation.ended', evacuationId: 'ev1' },
      _contentAvailable: true,
    })
    expect(message).not.toHaveProperty('title')
    expect(message).not.toHaveProperty('body')
  })

  it('com EXPO_ACCESS_TOKEN manda Authorization Bearer', async () => {
    process.env.EXPO_ACCESS_TOKEN = 'segredo-de-teste'
    const db = prisma()
    db.pushToken.findMany.mockResolvedValue(rows(1))
    const send = transport()
    await new PushService(db, send).sendToUsers(['u1'], STARTED)
    expect(send.mock.calls[0][2]).toEqual({ Authorization: 'Bearer segredo-de-teste' })
  })

  it('lotes de no máximo 100 mensagens', async () => {
    const db = prisma()
    db.pushToken.findMany.mockResolvedValue(rows(250))
    const send = transport()
    await new PushService(db, send).sendToUsers(['u1'], STARTED)
    expect(send.mock.calls.map((c) => c[1].length)).toEqual([100, 100, 50])
    expect(send.mock.calls[2][1][0].to).toBe(tokenOf(200))
  })

  it('DeviceNotRegistered apaga o token daquela posição; outro erro não apaga', async () => {
    const db = prisma()
    db.pushToken.findMany.mockResolvedValue(rows(3))
    const send = jest.fn().mockResolvedValue(okResponse([
      { status: 'ok', id: 'r0' },
      { status: 'error', message: 'não registrado', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', message: 'grande', details: { error: 'MessageTooBig' } },
    ]))
    await new PushService(db, send).sendToUsers(['u1'], STARTED)
    expect(db.pushToken.deleteMany).toHaveBeenCalledTimes(1)
    expect(db.pushToken.deleteMany).toHaveBeenCalledWith({ where: { token: { in: [tokenOf(1)] } } })
    expect(warn).toHaveBeenCalled()
  })

  it('nenhum DeviceNotRegistered: não apaga nada', async () => {
    const db = prisma()
    db.pushToken.findMany.mockResolvedValue(rows(2))
    await new PushService(db, transport()).sendToUsers(['u1'], STARTED)
    expect(db.pushToken.deleteMany).not.toHaveBeenCalled()
  })

  it('lote que falha na rede não impede o próximo e não rejeita', async () => {
    const db = prisma()
    db.pushToken.findMany.mockResolvedValue(rows(150))
    const send = transport()
    send.mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(new PushService(db, send).sendToUsers(['u1'], STARTED)).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'))
  })

  it('resposta não-2xx: registra no log, não apaga e não rejeita', async () => {
    const db = prisma()
    db.pushToken.findMany.mockResolvedValue(rows(1))
    const send = jest.fn().mockResolvedValue({ ok: false, status: 429, json: () => Promise.resolve({}) })
    await expect(new PushService(db, send).sendToUsers(['u1'], STARTED)).resolves.toBeUndefined()
    expect(db.pushToken.deleteMany).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('429'))
  })

  it('corpo sem data (ou JSON quebrado) não rejeita', async () => {
    const db = prisma()
    db.pushToken.findMany.mockResolvedValue(rows(1))
    const semData = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) })
    await expect(new PushService(db, semData).sendToUsers(['u1'], STARTED)).resolves.toBeUndefined()
    const quebrado = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('json')) })
    await expect(new PushService(db, quebrado).sendToUsers(['u1'], STARTED)).resolves.toBeUndefined()
    expect(db.pushToken.deleteMany).not.toHaveBeenCalled()
  })

  it('falha do banco ao ler os tokens não rejeita', async () => {
    const db = prisma()
    db.pushToken.findMany.mockRejectedValue(new Error('db fora'))
    await expect(new PushService(db, transport()).sendToUsers(['u1'], STARTED)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db fora'))
  })

  it('falha ao apagar token morto não rejeita', async () => {
    const db = prisma()
    db.pushToken.findMany.mockResolvedValue(rows(1))
    db.pushToken.deleteMany.mockRejectedValue(new Error('delete falhou'))
    const send = jest.fn().mockResolvedValue(okResponse([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]))
    await expect(new PushService(db, send).sendToUsers(['u1'], STARTED)).resolves.toBeUndefined()
  })
})

describe('PushService.notifyUsers', () => {
  it('dispara sem esperar: devolve na hora e nunca deixa rejeição solta', async () => {
    const svc = new PushService(prisma(), transport())
    let release!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const spy = jest.spyOn(svc, 'sendToUsers').mockReturnValue(pending)
    expect(svc.notifyUsers(['u1'], STARTED)).toBeUndefined()
    expect(spy).toHaveBeenCalledWith(['u1'], STARTED)
    release()
    await pending
  })

  it('rejeição inesperada do envio é engolida e registrada', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const svc = new PushService(prisma(), transport())
    jest.spyOn(svc, 'sendToUsers').mockRejectedValue(new Error('inesperado'))
    svc.notifyUsers(['u1'], STARTED)
    await new Promise((r) => setImmediate(r))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('inesperado'))
    warn.mockRestore()
  })
})
