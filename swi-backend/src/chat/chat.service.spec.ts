import { ChatService } from './chat.service'
import { NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

const media = () => ({
  presignGet: jest.fn(async (k: string) => `signed:${k}`),
}) as any
const realtime = () => ({ emitToUsers: jest.fn() }) as any
const notifications = () => ({ createFor: jest.fn(), enqueueForMany: jest.fn() }) as any

const prisma = () => ({
  conversation: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  message: { findMany: jest.fn(), create: jest.fn() },
  user: { findMany: jest.fn(), findUnique: jest.fn() },
  $executeRaw: jest.fn().mockResolvedValue(1),
}) as any

const A = 'aaaa', B = 'bbbb'
const CONV = [A, B].sort().join('#')

const userRow = (id: string, over: any = {}) => ({
  id, name: `n-${id}`, role: 'WORKER', approvalStatus: 'APPROVED',
  profile: {
    fullName: `full-${id}`, sector: 'Setor Leste', jobTitle: 'Operador',
    avatarKey: `chat/avatars/${id}.png`,
    birthDate: new Date('1990-05-04'), bloodType: 'B+', allergies: 'Poeira',
  },
  ...over,
})
const convRow = (over: any = {}) => ({
  id: CONV, participants: [A, B], participantNames: ['full-aaaa', 'full-bbbb'],
  participantSubtitles: ['Setor Leste', 'Setor Leste'], participantAvatarKeys: ['chat/avatars/aaaa.png', 'chat/avatars/bbbb.png'],
  lastMessageBody: 'oi', lastMessageAt: new Date('2026-06-23T13:00:00Z'), unreadByJson: { aaaa: 2 }, ...over,
})
const msgRow = (over: any = {}) => ({
  id: 'm1', conversationId: CONV, senderId: B, body: 'oi', imageKey: null, sentAt: new Date('2026-06-23T13:00:00Z'), ...over,
})

describe('ChatService', () => {
  it('listDirectory traz workers aprovados DA MESMA empresa exceto eu, presignando avatar', async () => {
    const db = prisma(); db.user.findMany.mockResolvedValue([userRow(B)])
    const out = await new ChatService(db, media(), realtime(), notifications()).listDirectory(A, 'org1')
    const where = db.user.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ approvalStatus: 'APPROVED', role: 'WORKER', id: { not: A }, companyId: 'org1' })
    expect(db.user.findMany.mock.calls[0][0].take).toBe(200)
    // birthDate/bloodType/allergies vão junto: o painel do chat mostrava
    // 26 anos / O+ pra todo contato por não ter esses campos (QA de volume).
    expect(out[0]).toEqual({
      workerId: B, name: 'full-bbbb', sector: 'Setor Leste', role: 'Operador',
      avatarUri: 'signed:chat/avatars/bbbb.png',
      birthDate: new Date('1990-05-04').toISOString(), bloodType: 'B+', allergies: 'Poeira',
    })
  })

  it('listConversations escopa em participants ∋ eu e ordena por recência', async () => {
    const db = prisma(); db.conversation.findMany.mockResolvedValue([convRow()])
    const out = await new ChatService(db, media(), realtime(), notifications()).listConversations(A)
    expect(db.conversation.findMany.mock.calls[0][0].where).toEqual({ participants: { has: A } })
    expect(db.conversation.findMany.mock.calls[0][0].take).toBe(200)
    expect(out[0].participantAvatars).toEqual(['signed:chat/avatars/aaaa.png', 'signed:chat/avatars/bbbb.png'])
    expect(out[0].unreadBy).toEqual({ aaaa: 2 })
    expect(out[0].lastMessageAt).toBe('2026-06-23T13:00:00.000Z')
  })

  it('listMessages de não-membro → 404', async () => {
    const db = prisma(); db.conversation.findUnique.mockResolvedValue(convRow({ participants: ['x', 'y'] }))
    await expect(new ChatService(db, media(), realtime(), notifications()).listMessages(A, CONV)).rejects.toThrow(NotFoundException)
  })

  it('listMessages devolve as mensagens (asc) presignando imageKey', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(convRow())
    db.message.findMany.mockResolvedValue([msgRow(), msgRow({ id: 'm2', imageKey: 'chat/x.jpg', body: null })])
    const out = await new ChatService(db, media(), realtime(), notifications()).listMessages(A, CONV)
    expect(db.message.findMany.mock.calls[0][0].orderBy).toEqual({ sentAt: 'asc' })
    expect(db.message.findMany.mock.calls[0][0].take).toBe(-200)
    expect(out[0].imageUri).toBeNull()
    expect(out[1].imageUri).toBe('signed:chat/x.jpg')
    expect(out[0].senderId).toBe(B)
  })

  it('sendMessage cria a conversa lazy (create-or-attach) quando não existe', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(null)
    db.user.findMany.mockResolvedValue([userRow(A), userRow(B)])
    db.conversation.create.mockResolvedValue(convRow({ lastMessageBody: null, lastMessageAt: null, unreadByJson: {} }))
    db.message.create.mockResolvedValue(msgRow({ senderId: A, body: 'novo' }))
    db.conversation.update.mockResolvedValue(convRow())
    const rt = realtime()
    const out = await new ChatService(db, media(), rt, notifications()).sendMessage(A, CONV, { body: 'novo' })
    expect(db.conversation.create).toHaveBeenCalledTimes(1)
    const created = db.conversation.create.mock.calls[0][0].data
    expect(created.id).toBe(CONV)
    expect(created.participants).toEqual([A, B])
    expect(out.body).toBe('novo')
    expect(rt.emitToUsers).toHaveBeenCalledWith([A, B], 'message', expect.objectContaining({ id: 'm1' }))
  })

  it('sendMessage emite UPDATE atômico do unread pro destinatário (não conversation.update)', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(convRow({ unreadByJson: { bbbb: 1 } }))
    db.message.create.mockResolvedValue(msgRow({ senderId: A, body: 'e aí' }))
    await new ChatService(db, media(), realtime(), notifications()).sendMessage(A, CONV, { body: 'e aí' })
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    const params = db.$executeRaw.mock.calls[0]        // [templateStrings, ...values]
    expect(params).toContain(B)                        // destinatário (não-remetente)
    expect(params).toContain(CONV)                     // a conversa certa
    expect(params).toContain('e aí')                   // lastMessageBody dobrado no mesmo UPDATE
    expect(db.conversation.update).not.toHaveBeenCalled() // RMW eliminado
  })

  it('sendMessage num conv que não me contém → 404', async () => {
    const db = prisma()
    await expect(new ChatService(db, media(), realtime(), notifications()).sendMessage('zzzz', CONV, { body: 'x' })).rejects.toThrow(NotFoundException)
  })

  it('sendMessage com id não-canônico (invertido) → 404 sem tocar no banco', async () => {
    const db = prisma()
    const reversed = [B, A].join('#') // 'bbbb#aaaa' — não é a forma sort()
    await expect(new ChatService(db, media(), realtime(), notifications()).sendMessage(A, reversed, { body: 'x' })).rejects.toThrow(NotFoundException)
    expect(db.conversation.findUnique).not.toHaveBeenCalled()
    expect(db.conversation.create).not.toHaveBeenCalled()
  })

  it('sendMessage que criaria conversa com participante inexistente → 404', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(null)
    db.user.findMany.mockResolvedValue([userRow(A)]) // só 1 dos 2 ids existe
    await expect(new ChatService(db, media(), realtime(), notifications()).sendMessage(A, CONV, { body: 'x' })).rejects.toThrow(NotFoundException)
    expect(db.conversation.create).not.toHaveBeenCalled()
  })

  it('markRead zera meu unread via UPDATE atômico (membership ok)', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(convRow({ unreadByJson: { aaaa: 5, bbbb: 1 } }))
    await new ChatService(db, media(), realtime(), notifications()).markRead(A, CONV)
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(db.$executeRaw.mock.calls[0]).toContain(A)   // zera o MEU contador
    expect(db.conversation.update).not.toHaveBeenCalled()
  })

  it('sendMessage dispara notificação cross-domain best-effort pro destinatário', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(convRow({ unreadByJson: {} }))
    db.message.create.mockResolvedValue(msgRow({ senderId: A, body: 'e aí' }))
    db.conversation.update.mockResolvedValue(convRow())
    db.user.findUnique.mockResolvedValue(userRow(A))
    const notif = notifications()
    await new ChatService(db, media(), realtime(), notif).sendMessage(A, CONV, { body: 'e aí' })
    expect(notif.enqueueForMany).toHaveBeenCalledWith([B], expect.objectContaining({ domain: 'chat', title: 'full-aaaa', body: 'e aí', targetId: CONV }))
  })

  it('sendMessage não quebra se a notificação falhar (best-effort)', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(convRow({ unreadByJson: {} }))
    db.message.create.mockResolvedValue(msgRow({ senderId: A, body: 'e aí' }))
    db.conversation.update.mockResolvedValue(convRow())
    db.user.findUnique.mockResolvedValue(userRow(A))
    const notif = notifications()
    notif.enqueueForMany.mockRejectedValue(new Error('boom'))
    const rt = realtime()
    const out = await new ChatService(db, media(), rt, notif).sendMessage(A, CONV, { body: 'e aí' })
    expect(out.body).toBe('e aí')
    expect(rt.emitToUsers).toHaveBeenCalledWith([A, B], 'message', expect.objectContaining({ id: 'm1' }))
  })

  it('sendMessage: create concorrente que colide (P2002) re-busca a conv, não 500', async () => {
    const db = prisma()
    // 1ª findUnique (início) → null; 2ª (após P2002) → conv já criada pelo request rival
    db.conversation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(convRow({ unreadByJson: {} }))
    db.user.findMany.mockResolvedValue([userRow(A), userRow(B)])
    db.conversation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5.22.0' }),
    )
    db.message.create.mockResolvedValue(msgRow({ senderId: A, body: 'novo' }))
    db.conversation.update.mockResolvedValue(convRow())
    const out = await new ChatService(db, media(), realtime(), notifications()).sendMessage(A, CONV, { body: 'novo' })
    expect(out.body).toBe('novo')
    expect(db.conversation.findUnique).toHaveBeenCalledTimes(2) // re-buscou após a colisão
  })
})
