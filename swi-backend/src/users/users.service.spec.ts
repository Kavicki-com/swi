import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { UsersService } from './users.service'

const prisma = () => ({ user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn() } }) as any
// Espelha a convenção do work-orders.service.spec: presignGet devolve 'signed:<key>'.
const media = () => ({ presignGet: jest.fn((k: string) => Promise.resolve('signed:' + k)) }) as any

describe('UsersService', () => {
  it('approve() vira approvalStatus p/ APPROVED', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1' })
    db.user.update.mockResolvedValue({ id: 'u1', approvalStatus: 'APPROVED' })
    const svc = new UsersService(db, media())
    const r = await svc.approve('u1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { approvalStatus: 'APPROVED' } })
    expect(r.approvalStatus).toBe('APPROVED')
  })

  it('approve() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db, media()).approve('nope')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('listPending() retorna só os PENDING com campos selecionados', async () => {
    const db = prisma()
    db.user.findMany = jest.fn().mockResolvedValue([{ id: 'u1', email: 'a@b.c', name: 'A', createdAt: new Date(0) }])
    const r = await new UsersService(db, media()).listPending()
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
    const r = await new UsersService(db, media()).reject('u1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { approvalStatus: 'REJECTED' } })
    expect(r.approvalStatus).toBe('REJECTED')
  })

  it('reject() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db, media()).reject('nope')).rejects.toBeInstanceOf(NotFoundException)
  })

  // ---------------- list ----------------

  it('list() filtra por role+approvalStatus e mapeia pro summary DTO com avatar assinado', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([
      {
        id: 'u1',
        name: 'W1',
        email: 'w1@x.com',
        role: 'WORKER',
        approvalStatus: 'APPROVED',
        companyRole: null,
        createdAt: new Date(0),
        profile: {
          fullName: 'Worker Um',
          jobTitle: 'Operador',
          sector: 'Norte',
          birthDate: new Date('1990-05-04'),
          avatarKey: 'chat/av1.png',
        },
      },
    ])
    const svc = new UsersService(db, media())
    const r = await svc.list('WORKER', 'APPROVED')
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { role: 'WORKER', approvalStatus: 'APPROVED' },
      include: { profile: true },
      orderBy: { name: 'asc' },
      take: 200,
    })
    expect(r[0]).toEqual({
      id: 'u1',
      name: 'Worker Um',
      email: 'w1@x.com',
      role: 'WORKER',
      approvalStatus: 'APPROVED',
      jobTitle: 'Operador',
      sector: 'Norte',
      birthDate: new Date('1990-05-04').toISOString(),
      avatar: 'signed:chat/av1.png',
      companyRole: null,
      createdAt: new Date(0).toISOString(),
    })
  })

  it('list() sem filtros manda where vazio', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([])
    await new UsersService(db, media()).list()
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: {},
      include: { profile: true },
      orderBy: { name: 'asc' },
      take: 200,
    })
  })

  it('list() sem profile usa fallbacks (name do user, strings vazias, birthDate/avatar nulos)', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([
      {
        id: 'u2',
        name: 'W2',
        email: 'w2@x.com',
        role: 'WORKER',
        approvalStatus: 'PENDING',
        companyRole: null,
        createdAt: new Date(0),
        profile: null,
      },
    ])
    const r = await new UsersService(db, media()).list()
    expect(r[0]).toEqual({
      id: 'u2',
      name: 'W2',
      email: 'w2@x.com',
      role: 'WORKER',
      approvalStatus: 'PENDING',
      jobTitle: '',
      sector: '',
      birthDate: null,
      avatar: '',
      companyRole: null,
      createdAt: new Date(0).toISOString(),
    })
  })

  it('list() rejeita role inválido com BadRequest', async () => {
    const db = prisma()
    await expect(new UsersService(db, media()).list('BOSS' as any)).rejects.toBeInstanceOf(BadRequestException)
  })

  // ---------------- getOne ----------------

  it('getOne() devolve detalhe com telefone, cpf e empresa', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({
      id: 'a1',
      name: 'Adm',
      email: 'a@x.com',
      role: 'ADMIN',
      approvalStatus: 'APPROVED',
      companyRole: 'owner',
      createdAt: new Date(0),
      profile: {
        fullName: 'Admin Full',
        jobTitle: 'Diretor',
        sector: 'Gestão',
        birthDate: new Date('1980-01-02'),
        avatarKey: 'chat/adm.png',
        phone: '11999',
        cpf: '12345',
      },
      company: { id: 'c1', name: 'ACME' },
    })
    const r = await new UsersService(db, media()).getOne('a1')
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'a1' },
      include: { profile: true, company: true },
    })
    expect(r).toEqual({
      id: 'a1',
      name: 'Admin Full',
      email: 'a@x.com',
      role: 'ADMIN',
      approvalStatus: 'APPROVED',
      jobTitle: 'Diretor',
      sector: 'Gestão',
      birthDate: new Date('1980-01-02').toISOString(),
      avatar: 'signed:chat/adm.png',
      companyRole: 'owner',
      createdAt: new Date(0).toISOString(),
      phone: '11999',
      cpf: '12345',
      company: { id: 'c1', name: 'ACME' },
    })
  })

  it('getOne() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db, media()).getOne('nope')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('UsersService.create', () => {
  it('cria User+Profile APPROVED/verificado com role e companyId do admin', async () => {
    const db = prisma()
    db.user.findUnique
      .mockResolvedValueOnce(null)                          // findByEmail: não existe
      .mockResolvedValueOnce({ id: 'adm', companyId: 'c1' }) // findById(admin)
    db.user.create.mockResolvedValue({ id: 'new', name: 'Zé', email: 'ze@x.com', role: 'WORKER', approvalStatus: 'APPROVED', companyRole: null, createdAt: new Date(0), profile: null })
    const svc = new UsersService(db, media())
    await svc.create('adm', { name: 'Zé', email: 'ze@x.com', password: 'senha123', role: 'WORKER', phone: '11', cpf: '123', birthDate: '1990-05-04' })
    const arg = db.user.create.mock.calls[0][0]
    expect(arg.data).toMatchObject({ name: 'Zé', email: 'ze@x.com', role: 'WORKER', approvalStatus: 'APPROVED', emailVerified: true, companyId: 'c1' })
    expect(arg.data.passwordHash).toBeTruthy()
    expect(arg.data.passwordHash).not.toBe('senha123')      // nunca senha em texto puro
    expect(arg.data.passwordHash).toMatch(/^\$2[aby]\$/)     // formato bcrypt
    expect(arg.data.profile.create).toMatchObject({ fullName: 'Zé', phone: '11', cpf: '123', birthDate: new Date('1990-05-04') })
  })
  it('email já cadastrado → ConflictException', async () => {
    const db = prisma(); db.user.findUnique.mockResolvedValueOnce({ id: 'x' })
    await expect(new UsersService(db, media()).create('adm', { name: 'Z', email: 'z@x.com', password: 'senha123', role: 'WORKER' })).rejects.toBeInstanceOf(ConflictException)
  })
  it('corrida: P2002 do create vira ConflictException', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'adm', companyId: 'c1' })
    db.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }))
    await expect(new UsersService(db, media()).create('adm', { name: 'Z', email: 'z@x.com', password: 'senha123', role: 'WORKER' })).rejects.toBeInstanceOf(ConflictException)
  })
  it('admin sem empresa → companyId null', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'adm', companyId: null })
    db.user.create.mockResolvedValue({ id: 'n', name: 'Z', email: 'z@x.com', role: 'WORKER', approvalStatus: 'APPROVED', companyRole: null, createdAt: new Date(0), profile: null })
    await new UsersService(db, media()).create('adm', { name: 'Z', email: 'z@x.com', password: 'senha123', role: 'WORKER' })
    expect(db.user.create.mock.calls[0][0].data.companyId).toBeNull()
  })
})

describe('UsersService.setActive', () => {
  it('atualiza active', async () => {
    const db = prisma(); db.user.update.mockResolvedValue({ id: 'u1', active: false })
    const r = await new UsersService(db, media()).setActive('u1', false)
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { active: false } })
    expect(r).toEqual({ id: 'u1', active: false })
  })
})

describe('UsersService.remove', () => {
  it('excluir a si mesmo → BadRequest', async () => {
    await expect(new UsersService(prisma(), media()).remove('me', 'me')).rejects.toBeInstanceOf(BadRequestException)
  })
  it('happy: apaga profile + user', async () => {
    const db = prisma()
    db.profile = { deleteMany: jest.fn().mockResolvedValue({}) }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    db.user.delete = jest.fn().mockResolvedValue({ id: 'u1' })
    await new UsersService(db, media()).remove('u1', 'admin')
    expect(db.profile.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } })
  })
  it('FK vinculada (P2003) → Conflict', async () => {
    const db = prisma()
    db.profile = { deleteMany: jest.fn().mockResolvedValue({}) }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    db.user.delete = jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }))
    await expect(new UsersService(db, media()).remove('u1', 'admin')).rejects.toBeInstanceOf(ConflictException)
  })
})
