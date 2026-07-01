import { NotFoundException } from '@nestjs/common'
import { UsersService } from './users.service'

const prisma = () => ({ user: { findUnique: jest.fn(), update: jest.fn() } }) as any

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
})
