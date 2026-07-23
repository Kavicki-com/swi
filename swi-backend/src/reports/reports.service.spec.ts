import { NotFoundException } from '@nestjs/common'
import { ReportsService } from './reports.service'

const media = () =>
  ({
    presignGet: jest.fn(async (k: string) => `signed:${k}`),
    presignGetMany: jest.fn(async (ks: string[]) => ks.map((k) => `signed:${k}`)),
  }) as any

const notifications = () => ({ enqueueForMany: jest.fn() }) as any

const prisma = () =>
  ({
    report: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    comment: { create: jest.fn() },
  }) as any

const row = (over = {}) => ({
  id: 'r1',
  title: 'T',
  summary: null,
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Ana',
  authorAvatarKey: 'reports/av.jpg',
  creationDate: new Date('2026-01-02T00:00:00Z'), // 00:00 UTC = 21:00 BRT do dia 01

  sector: null,
  responsibles: ['Ana'],
  details: null,
  imageKeys: ['reports/x.jpg'],
  activities: [],
  ...over,
})

describe('ReportsService', () => {
  it('list ordena por createdAt desc e mapeia keys→urls presigned', async () => {
    const db = prisma()
    db.report.findMany.mockResolvedValue([row()])
    const out = await new ReportsService(db, media(), notifications()).list()
    expect(db.report.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 200 })
    expect(out[0].images).toEqual(['signed:reports/x.jpg'])
    expect(out[0].imageKeys).toEqual(['reports/x.jpg']) // keys crus coexistem com as urls presigned
    expect(out[0].authorAvatarUri).toBe('signed:reports/av.jpg')
    expect(out[0].creationDate).toBe('01/01/2026') // BRT (UTC-3) rola pro dia anterior
    expect(out[0].summary).toBe('') // null → '' (telas exigem string)
  })

  it('DTO carrega os imageKeys crus além das urls presigned (destrava edição de anexo)', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(row({ imageKeys: ['reports/a.jpg', 'reports/b.jpg'], comments: [] }))
    const out = await new ReportsService(db, media(), notifications()).get('r1')
    expect(out!.imageKeys).toEqual(['reports/a.jpg', 'reports/b.jpg']) // keys crus, sem presign
    expect(out!.images).toEqual(['signed:reports/a.jpg', 'signed:reports/b.jpg']) // urls presigned coexistem
  })

  it('get inexistente → null', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(null)
    expect(await new ReportsService(db, media(), notifications()).get('nope')).toBeNull()
  })

  it('create seta authorId do JWT, denorm do profile e defaults', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({
      name: 'Fallback',
      profile: { fullName: 'Ana Perfil', avatarKey: 'reports/av.jpg', sector: 'Noroeste' },
    })
    db.report.create.mockResolvedValue(row({ authorName: 'Ana Perfil' }))
    db.user.findMany.mockResolvedValue([])
    await new ReportsService(db, media(), notifications()).create('u1', {
      title: 'T',
      responsibles: [],
      imageKeys: ['reports/x.jpg'],
    } as any)
    const arg = db.report.create.mock.calls[0][0].data
    expect(arg.authorId).toBe('u1')
    expect(arg.authorName).toBe('Ana Perfil')
    expect(arg.sector).toBe('Noroeste')
    expect(arg.status).toBe('pending')
    expect(arg.statusLabel).toBe('Em Revisão')
    expect(arg.activities).toEqual([])
  })

  it('create sem profile usa user.name como authorName', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ name: 'Fallback', profile: null })
    db.report.create.mockResolvedValue(row())
    db.user.findMany.mockResolvedValue([])
    await new ReportsService(db, media(), notifications()).create('u1', { title: 'T' } as any)
    expect(db.report.create.mock.calls[0][0].data.authorName).toBe('Fallback')
  })

  it('create faz broadcast pros outros workers aprovados (best-effort)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ name: 'A', profile: null })
    db.report.create.mockResolvedValue(row({ id: 'r9', title: 'R9' }))
    db.user.findMany.mockResolvedValue([{ id: 'w2' }, { id: 'w3' }])
    const notif = notifications()
    await new ReportsService(db, media(), notif).create('author-1', { title: 'R9' } as any)
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { role: 'WORKER', approvalStatus: 'APPROVED', id: { not: 'author-1' } }, select: { id: true } })
    expect(notif.enqueueForMany).toHaveBeenCalledWith(['w2', 'w3'], expect.objectContaining({ domain: 'reports', title: 'Novo relatório', body: 'R9', targetId: 'r9' }))
  })

  it('create não quebra se o broadcast falhar (best-effort)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ name: 'A', profile: null })
    db.report.create.mockResolvedValue(row({ id: 'r9', title: 'R9' }))
    db.user.findMany.mockResolvedValue([{ id: 'w2' }])
    const notif = notifications()
    notif.enqueueForMany.mockRejectedValue(new Error('boom'))
    const out = await new ReportsService(db, media(), notif).create('author-1', { title: 'R9' } as any)
    expect(out.id).toBe('r9')
  })

  it('update aplica só os campos fornecidos e devolve o DTO', async () => {
    const db = prisma()
    db.report.update.mockResolvedValue(row({ title: 'Novo', status: 'accept', statusLabel: 'Aceito' }))
    const out = await new ReportsService(db, media(), notifications()).update('r1', 'u1', {
      title: 'Novo',
      status: 'accept',
      statusLabel: 'Aceito',
    } as any)
    const arg = db.report.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'r1' })
    expect(arg.data).toEqual({ title: 'Novo', status: 'accept', statusLabel: 'Aceito' })
    expect(out.title).toBe('Novo')
    expect(out.status).toBe('accept')
    expect(out.statusLabel).toBe('Aceito')
  })

  it('update com P2025 → NotFoundException', async () => {
    const db = prisma()
    db.report.update.mockRejectedValue({ code: 'P2025' })
    await expect(
      new ReportsService(db, media(), notifications()).update('nope', 'u1', { title: 'x' } as any),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('addComment cria comentário e devolve o DTO (authorName do profile, avatar presigned)', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue({ id: 'r1' })
    db.user.findUnique.mockResolvedValue({
      name: 'Fallback',
      profile: { fullName: 'Ana Perfil', avatarKey: 'reports/av.jpg' },
    })
    db.comment.create.mockResolvedValue({
      id: 'c1',
      reportId: 'r1',
      authorId: 'u1',
      body: 'Comentário',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    })
    const out = await new ReportsService(db, media(), notifications()).addComment('r1', 'u1', { body: 'Comentário' } as any)
    expect(db.report.findUnique).toHaveBeenCalledWith({ where: { id: 'r1' }, select: { id: true } })
    expect(db.comment.create.mock.calls[0][0].data).toEqual({ reportId: 'r1', authorId: 'u1', body: 'Comentário' })
    expect(out).toEqual({
      id: 'c1',
      body: 'Comentário',
      authorName: 'Ana Perfil',
      authorAvatarUri: 'signed:reports/av.jpg',
      createdAt: '01/01/2026',
    })
  })

  it('addComment sem profile usa user.name e avatar vazio', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue({ id: 'r1' })
    db.user.findUnique.mockResolvedValue({ name: 'Fallback', profile: null })
    db.comment.create.mockResolvedValue({
      id: 'c2',
      reportId: 'r1',
      authorId: 'u1',
      body: 'Oi',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    })
    const out = await new ReportsService(db, media(), notifications()).addComment('r1', 'u1', { body: 'Oi' } as any)
    expect(out.authorName).toBe('Fallback')
    expect(out.authorAvatarUri).toBe('')
  })

  it('addComment em relatório inexistente → NotFoundException', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(null)
    await expect(
      new ReportsService(db, media(), notifications()).addComment('nope', 'u1', { body: 'x' } as any),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(db.comment.create).not.toHaveBeenCalled()
  })

  it('get embute comments ordenados por createdAt asc, cada um com seu autor', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(
      row({
        comments: [
          {
            id: 'c1',
            reportId: 'r1',
            authorId: 'u1',
            body: 'Primeiro',
            createdAt: new Date('2026-01-02T00:00:00Z'),
            author: { name: 'Ana', profile: { fullName: 'Ana Perfil', avatarKey: 'reports/av.jpg' } },
          },
          {
            id: 'c2',
            reportId: 'r1',
            authorId: 'u2',
            body: 'Segundo',
            createdAt: new Date('2026-01-03T00:00:00Z'),
            author: { name: 'Bruno', profile: null },
          },
        ],
      }),
    )
    const out = await new ReportsService(db, media(), notifications()).get('r1')
    expect(db.report.findUnique).toHaveBeenCalledWith({
      where: { id: 'r1' },
      include: {
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { include: { profile: true } } },
        },
      },
    })
    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(out!.comments).toEqual([
      { id: 'c1', body: 'Primeiro', authorName: 'Ana Perfil', authorAvatarUri: 'signed:reports/av.jpg', createdAt: '01/01/2026' },
      { id: 'c2', body: 'Segundo', authorName: 'Bruno', authorAvatarUri: '', createdAt: '02/01/2026' },
    ])
  })
})
