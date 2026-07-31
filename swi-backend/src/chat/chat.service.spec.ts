import { ChatService } from './chat.service'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

const media = () => ({
  presignGet: jest.fn(async (k: string) => `signed:${k}`),
}) as any
const realtime = () => ({ emitToUsers: jest.fn() }) as any
const notifications = () => ({ createFor: jest.fn(), enqueueForMany: jest.fn() }) as any

const prisma = () => ({
  conversation: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  message: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
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
    birthDate: new Date('1990-05-04'), bloodType: 'B+', allergies: 'Poeira', gender: 'female',
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
  // 2026-07-27: o diretório deixou de ser org-scoped e de filtrar papel — o
  // worker conversa com qualquer pessoa no app. Sobra o que ainda faz sentido:
  // conta aprovada (PENDING/REJECTED nem loga) e eu fora da minha própria lista.
  it('listDirectory traz qualquer conta aprovada exceto eu, presignando avatar', async () => {
    const db = prisma(); db.user.findMany.mockResolvedValue([userRow(B)])
    const out = await new ChatService(db, media(), realtime(), notifications()).listDirectory(A)
    const where = db.user.findMany.mock.calls[0][0].where
    expect(where).toEqual({
      approvalStatus: 'APPROVED',
      id: { not: A },
    })
    expect(db.user.findMany.mock.calls[0][0].take).toBe(200)
    // birthDate/bloodType/allergies/gender vão junto: o painel do chat mostrava
    // 26 anos / O+ pra todo contato por não ter esses campos (QA de volume), e
    // fixava "Masculino" mesmo pras colaboradoras (QA 2026-07-26).
    expect(out[0]).toEqual({
      workerId: B, name: 'full-bbbb', sector: 'Setor Leste', role: 'Operador',
      avatarUri: 'signed:chat/avatars/bbbb.png',
      birthDate: new Date('1990-05-04').toISOString(), bloodType: 'B+', allergies: 'Poeira',
      gender: 'female',
    })
  })

  // Antes o `where` levava companyId, então o worker de uma empresa não
  // enxergava ninguém de outra — nem pra iniciar conversa.
  it('listDirectory não recorta por empresa nem por papel', async () => {
    const db = prisma(); db.user.findMany.mockResolvedValue([userRow(B)])
    await new ChatService(db, media(), realtime(), notifications()).listDirectory(A)
    const where = db.user.findMany.mock.calls[0][0].where
    expect(where).not.toHaveProperty('companyId')
    expect(where).not.toHaveProperty('role')
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

// QA Web #4: o menu de ações da mensagem pedia editar, excluir, copiar. Copiar é
// do cliente; editar e excluir não existiam em lugar nenhum — o controller tinha
// listar, enviar e marcar como lida, e a tabela não tinha campo de edição nem de
// exclusão.
//
// Decisões do usuário (2026-07-31): só o AUTOR edita e exclui, sem limite de
// tempo; excluir deixa MARCA em vez de apagar; editar deixa a marca "editada".
describe('ChatService — editar e excluir mensagem', () => {
  const svc = (db: any, rt: any = realtime()) =>
    new ChatService(db, media(), rt, notifications())

  const setup = (msgOver: any = {}) => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(convRow())
    db.message.findUnique.mockResolvedValue(msgRow({ senderId: A, ...msgOver }))
    // Por default a mensagem editada NÃO é a última da conversa.
    db.message.findFirst.mockResolvedValue(msgRow({ id: 'outra' }))
    db.message.update.mockImplementation(async ({ data }: any) =>
      msgRow({ senderId: A, ...msgOver, ...data }),
    )
    return db
  }

  it('autor edita: grava o texto novo, marca editedAt e devolve o dto atualizado', async () => {
    const db = setup()
    const out = await svc(db).editMessage(A, CONV, 'm1', { body: '  texto corrigido  ' })
    const data = db.message.update.mock.calls[0][0].data
    expect(data.body).toBe('texto corrigido') // trim aplicado
    expect(data.editedAt).toBeInstanceOf(Date)
    expect(out.body).toBe('texto corrigido')
    expect(out.editedAt).toBeTruthy()
  })

  it('quem não é autor não edita, e nada é gravado', async () => {
    const db = setup({ senderId: B })
    await expect(svc(db).editMessage(A, CONV, 'm1', { body: 'na marra' })).rejects.toThrow(
      ForbiddenException,
    )
    expect(db.message.update).not.toHaveBeenCalled()
  })

  it('mensagem já excluída não pode ser editada', async () => {
    const db = setup({ deletedAt: new Date('2026-07-30T10:00:00Z') })
    await expect(svc(db).editMessage(A, CONV, 'm1', { body: 'ressuscita' })).rejects.toThrow(
      BadRequestException,
    )
    expect(db.message.update).not.toHaveBeenCalled()
  })

  it('texto que fica vazio depois do trim é recusado', async () => {
    const db = setup()
    await expect(svc(db).editMessage(A, CONV, 'm1', { body: '   ' })).rejects.toThrow(
      BadRequestException,
    )
    expect(db.message.update).not.toHaveBeenCalled()
  })

  it('mensagem de outra conversa não é encontrada, mesmo com id válido', async () => {
    const db = setup()
    db.message.findUnique.mockResolvedValue(msgRow({ senderId: A, conversationId: 'xxxx#yyyy' }))
    await expect(svc(db).editMessage(A, CONV, 'm1', { body: 'oi' })).rejects.toThrow(
      NotFoundException,
    )
  })

  it('não-membro da conversa não chega nem a olhar a mensagem', async () => {
    const db = setup()
    db.conversation.findUnique.mockResolvedValue(convRow({ participants: [B, 'cccc'] }))
    await expect(svc(db).editMessage(A, CONV, 'm1', { body: 'oi' })).rejects.toThrow(
      NotFoundException,
    )
    expect(db.message.findUnique).not.toHaveBeenCalled()
  })

  it('editar a ÚLTIMA mensagem atualiza o preview da conversa', async () => {
    const db = setup()
    db.message.findFirst.mockResolvedValue(msgRow({ id: 'm1' })) // a editada é a última
    await svc(db).editMessage(A, CONV, 'm1', { body: 'texto novo' })
    const data = db.conversation.update.mock.calls[0][0].data
    expect(data.lastMessageBody).toBe('texto novo')
  })

  it('editar mensagem do MEIO não mexe no preview', async () => {
    const db = setup()
    await svc(db).editMessage(A, CONV, 'm1', { body: 'texto novo' })
    expect(db.conversation.update).not.toHaveBeenCalled()
  })

  it('a edição chega aos dois participantes pelo socket, com o estado atual', async () => {
    const db = setup()
    const rt = realtime()
    await svc(db, rt).editMessage(A, CONV, 'm1', { body: 'texto novo' })
    const [users, evento, payload] = rt.emitToUsers.mock.calls[0]
    expect(users).toEqual([A, B])
    expect(evento).toBe('message')
    expect(payload.id).toBe('m1')
    expect(payload.body).toBe('texto novo')
  })

  it('autor exclui: marca deletedAt e o dto para de vazar o texto', async () => {
    const db = setup()
    const out = await svc(db).deleteMessage(A, CONV, 'm1')
    const data = db.message.update.mock.calls[0][0].data
    expect(data.deletedAt).toBeInstanceOf(Date)
    // O body FICA no banco (reversível, auditável), mas não sai na API.
    expect(data.body).toBeUndefined()
    expect(out.body).toBe('')
    expect(out.imageUri).toBeNull()
    expect(out.deletedAt).toBeTruthy()
  })

  it('quem não é autor não exclui', async () => {
    const db = setup({ senderId: B })
    await expect(svc(db).deleteMessage(A, CONV, 'm1')).rejects.toThrow(ForbiddenException)
    expect(db.message.update).not.toHaveBeenCalled()
  })

  it('excluir de novo não remarca a data: a primeira exclusão é a que vale', async () => {
    const jaEra = new Date('2026-07-30T10:00:00Z')
    const db = setup({ deletedAt: jaEra })
    const out = await svc(db).deleteMessage(A, CONV, 'm1')
    expect(db.message.update).not.toHaveBeenCalled()
    expect(out.deletedAt).toBe(jaEra.toISOString())
  })

  it('excluir a ÚLTIMA mensagem troca o preview por "Mensagem excluída"', async () => {
    const db = setup()
    db.message.findFirst.mockResolvedValue(msgRow({ id: 'm1' }))
    await svc(db).deleteMessage(A, CONV, 'm1')
    expect(db.conversation.update.mock.calls[0][0].data.lastMessageBody).toBe('Mensagem excluída')
  })

  it('a exclusão também chega pelo socket, pra bolha virar lápide nos dois lados', async () => {
    const db = setup()
    const rt = realtime()
    await svc(db, rt).deleteMessage(A, CONV, 'm1')
    const [users, evento, payload] = rt.emitToUsers.mock.calls[0]
    expect(users).toEqual([A, B])
    expect(evento).toBe('message')
    expect(payload.deletedAt).toBeTruthy()
    expect(payload.body).toBe('')
  })

  it('a listagem carrega editedAt e deletedAt: sem isso a bolha não sabe o que mostrar', async () => {
    const db = prisma()
    db.conversation.findUnique.mockResolvedValue(convRow())
    db.message.findMany.mockResolvedValue([
      msgRow({ id: 'm1', editedAt: new Date('2026-07-31T09:00:00Z') }),
      msgRow({ id: 'm2', deletedAt: new Date('2026-07-31T09:30:00Z'), body: 'segredo' }),
    ])
    const out = await svc(db).listMessages(A, CONV)
    expect(out[0].editedAt).toBe(new Date('2026-07-31T09:00:00Z').toISOString())
    expect(out[1].deletedAt).toBeTruthy()
    expect(out[1].body).toBe('') // o texto da excluída não sai na listagem
  })
})
