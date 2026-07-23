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
})
