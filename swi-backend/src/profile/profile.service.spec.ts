import { ProfileService } from './profile.service'

const prisma = () => ({ profile: { findUnique: jest.fn(), upsert: jest.fn() } }) as any

describe('ProfileService', () => {
  it('getByUserId retorna o profile do usuário', async () => {
    const db = prisma()
    db.profile.findUnique.mockResolvedValue({ userId: 'u1', fullName: 'Ana' })
    const r = await new ProfileService(db).getByUserId('u1')
    expect(db.profile.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(r?.fullName).toBe('Ana')
  })

  it('getByUserId retorna null quando não existe', async () => {
    const db = prisma()
    db.profile.findUnique.mockResolvedValue(null)
    expect(await new ProfileService(db).getByUserId('nope')).toBeNull()
  })

  it('upsert cria quando não existe (create carrega userId)', async () => {
    const db = prisma()
    db.profile.upsert.mockResolvedValue({ userId: 'u1', city: 'SP' })
    await new ProfileService(db).upsert('u1', { city: 'SP' })
    expect(db.profile.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', city: 'SP' },
      update: { city: 'SP' },
    })
  })
})
