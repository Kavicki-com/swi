import { NotFoundException } from '@nestjs/common'
import { UsersService } from './users.service'

const prisma = () => ({ user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() } }) as any

describe('UsersService', () => {
  it('approve() vira approvalStatus p/ APPROVED', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1' })
    db.user.update.mockResolvedValue({ id: 'u1', approvalStatus: 'APPROVED' })
    const svc = new UsersService(db)
    const r = await svc.approve('u1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { approvalStatus: 'APPROVED' } })
    expect(r.approvalStatus).toBe('APPROVED')
  })

  it('approve() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db).approve('nope')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('listPending() retorna só os PENDING com campos selecionados', async () => {
    const db = prisma()
    db.user.findMany = jest.fn().mockResolvedValue([{ id: 'u1', email: 'a@b.c', name: 'A', createdAt: new Date(0) }])
    const r = await new UsersService(db).listPending()
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { approvalStatus: 'PENDING' },
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    expect(r).toHaveLength(1)
  })

  it('reject() vira approvalStatus p/ REJECTED', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1' })
    db.user.update.mockResolvedValue({ id: 'u1', approvalStatus: 'REJECTED' })
    const r = await new UsersService(db).reject('u1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { approvalStatus: 'REJECTED' } })
    expect(r.approvalStatus).toBe('REJECTED')
  })

  it('reject() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db).reject('nope')).rejects.toBeInstanceOf(NotFoundException)
  })
})
