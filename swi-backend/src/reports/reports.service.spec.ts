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
    reportComment: { create: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
  }) as any

const commentRow = (over = {}) => ({
  id: 'c1',
  reportId: 'r1',
  authorId: 'u1',
  authorName: 'Ana',
  authorAvatarKey: 'profile/av.jpg',
  text: 'Verificar válvula',
  createdAt: new Date('2026-01-02T00:00:00Z'), // 00:00 UTC = 21:00 BRT do dia 01
  ...over,
})

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
    expect(out[0].authorAvatarUri).toBe('signed:reports/av.jpg')
    expect(out[0].creationDate).toBe('01/01/2026') // BRT (UTC-3) rola pro dia anterior
    expect(out[0].summary).toBe('') // null → '' (telas exigem string)
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

  it('get inclui comments cronológicos no shape mobile (avatar presigned, date dd/mm/yyyy)', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue({ ...row(), comments: [commentRow()] })
    const out = await new ReportsService(db, media(), notifications()).get('r1')
    expect(db.report.findUnique).toHaveBeenCalledWith({
      where: { id: 'r1' },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    })
    expect(out!.comments).toEqual([
      { id: 'c1', authorName: 'Ana', authorAvatarUri: 'signed:profile/av.jpg', text: 'Verificar válvula', date: '01/01/2026' },
    ])
  })

  it('list devolve comments: [] (inbox não faz join de comentários)', async () => {
    const db = prisma()
    db.report.findMany.mockResolvedValue([row()])
    const out = await new ReportsService(db, media(), notifications()).list()
    expect(out[0].comments).toEqual([])
  })

  it('update aplica só os campos presentes no dto e devolve o shape do get', async () => {
    const db = prisma()
    db.report.update.mockResolvedValue(row({ title: 'Novo título' }))
    db.report.findUnique.mockResolvedValue({ ...row({ title: 'Novo título' }), comments: [] })
    const out = await new ReportsService(db, media(), notifications()).update('r1', {
      title: 'Novo título',
      responsibles: ['Elisa'],
    } as any)
    expect(db.report.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { title: 'Novo título', responsibles: ['Elisa'] },
    })
    expect(out!.title).toBe('Novo título')
    expect(out!.comments).toEqual([])
  })

  it('update inexistente (P2025) → null', async () => {
    const db = prisma()
    db.report.update.mockRejectedValue({ code: 'P2025' })
    const out = await new ReportsService(db, media(), notifications()).update('nope', { title: 'X' } as any)
    expect(out).toBeNull()
  })

  it('addComment cria com snapshots do profile e devolve o dto mobile', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue({ id: 'r1' })
    db.user.findUnique.mockResolvedValue({
      name: 'Fallback',
      profile: { fullName: 'Ana Perfil', avatarKey: 'profile/av.jpg' },
    })
    db.reportComment.create.mockResolvedValue(commentRow({ authorName: 'Ana Perfil' }))
    const out = await new ReportsService(db, media(), notifications()).addComment('r1', 'u1', 'Verificar válvula')
    expect(db.reportComment.create).toHaveBeenCalledWith({
      data: {
        reportId: 'r1',
        authorId: 'u1',
        authorName: 'Ana Perfil',
        authorAvatarKey: 'profile/av.jpg',
        text: 'Verificar válvula',
      },
    })
    expect(out).toEqual({
      id: 'c1',
      authorName: 'Ana Perfil',
      authorAvatarUri: 'signed:profile/av.jpg',
      text: 'Verificar válvula',
      date: '01/01/2026',
    })
  })

  it('addComment em relatório inexistente → null', async () => {
    const db = prisma()
    db.report.findUnique.mockResolvedValue(null)
    const out = await new ReportsService(db, media(), notifications()).addComment('nope', 'u1', 'X')
    expect(out).toBeNull()
    expect(db.reportComment.create).not.toHaveBeenCalled()
  })
})
