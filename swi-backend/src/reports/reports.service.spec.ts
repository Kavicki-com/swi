import { ReportsService } from './reports.service'

const media = () =>
  ({
    presignGet: jest.fn(async (k: string) => `signed:${k}`),
    presignGetMany: jest.fn(async (ks: string[]) => ks.map((k) => `signed:${k}`)),
  }) as any

const notifications = () => ({ enqueueForMany: jest.fn() }) as any

const prisma = () =>
  ({
    report: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), count: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    // $transaction([p1,p2]) resolves the array of PrismaPromises (form used in list()).
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
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
  it('list pagina (skip/take), total = count, envelope {items,total} + mapeia dto', async () => {
    const db = prisma()
    db.report.findMany.mockResolvedValue([row()])
    db.report.count.mockResolvedValue(10)
    const out = await new ReportsService(db, media(), notifications()).list(2, 4)
    expect(db.report.findMany).toHaveBeenCalledWith({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 4, take: 4 })
    expect(out.total).toBe(10)
    expect(out.items[0].images).toEqual(['signed:reports/x.jpg'])
    expect(out.items[0].creationDate).toBe('01/01/2026') // BRT (UTC-3)
    expect(out.items[0].summary).toBe('') // null → ''
  })

  it('list clampa limit a MAX_LIMIT e page<1 → página 1', async () => {
    const db = prisma()
    db.report.findMany.mockResolvedValue([])
    db.report.count.mockResolvedValue(0)
    await new ReportsService(db, media(), notifications()).list(0, 9999)
    expect(db.report.findMany).toHaveBeenCalledWith({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 50 })
  })

  it('list sem args → page 1, limit 4, envelope vazio', async () => {
    const db = prisma()
    db.report.findMany.mockResolvedValue([])
    db.report.count.mockResolvedValue(0)
    const out = await new ReportsService(db, media(), notifications()).list()
    expect(db.report.findMany).toHaveBeenCalledWith({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 4 })
    expect(out).toEqual({ items: [], total: 0 })
  })

  it('list clampa limit negativo → 1 e NaN → default 4', async () => {
    const db = prisma()
    db.report.findMany.mockResolvedValue([])
    db.report.count.mockResolvedValue(0)
    const svc = new ReportsService(db, media(), notifications())
    await svc.list(1, -5)
    expect(db.report.findMany).toHaveBeenLastCalledWith({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 1 })
    await svc.list(1, NaN as any)
    expect(db.report.findMany).toHaveBeenLastCalledWith({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 4 })
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
})
