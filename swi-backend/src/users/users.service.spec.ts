import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { UsersService } from './users.service'

const prisma = () => ({ user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn() } }) as any
// Espelha a convenção do work-orders.service.spec: presignGet devolve 'signed:<key>'.
const media = () => ({ presignGet: jest.fn((k: string) => Promise.resolve('signed:' + k)) }) as any

// Org-scoping (QA C1, 2026-07-24): TODA leitura/mutação de usuário é escopada
// pela empresa do requisitante — org nova não enxerga (nem mexe em) usuários da
// org seed. Alvo de outra empresa responde NotFound (não vaza existência).

describe('UsersService', () => {
  it('approve() vira approvalStatus p/ APPROVED (mesma empresa)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.user.update.mockResolvedValue({ id: 'u1', approvalStatus: 'APPROVED' })
    const svc = new UsersService(db, media())
    const r = await svc.approve('u1', 'org1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { approvalStatus: 'APPROVED' } })
    expect(r.approvalStatus).toBe('APPROVED')
  })

  it('approve() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db, media()).approve('nope', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('approve() de usuário de OUTRA empresa → NotFound sem tocar no update', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org2' })
    await expect(new UsersService(db, media()).approve('u1', 'org1')).rejects.toBeInstanceOf(NotFoundException)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('listPending() escopa por empresa além do PENDING', async () => {
    const db = prisma()
    db.user.findMany = jest.fn().mockResolvedValue([{ id: 'u1', email: 'a@b.c', name: 'A', createdAt: new Date(0) }])
    const r = await new UsersService(db, media()).listPending('org1')
    const args = db.user.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ approvalStatus: 'PENDING', companyId: 'org1' })
    expect(args.orderBy).toEqual({ createdAt: 'asc' })
    expect(r).toHaveLength(1)
  })

  // O admin decide aprovar em cima destes campos; a fila devolvia só nome e
  // e-mail e ele aprovava às cegas (QA 2026-07-26).
  it('listPending() devolve o perfil que o worker preencheu no cadastro', async () => {
    const db = prisma()
    db.user.findMany = jest.fn().mockResolvedValue([
      {
        id: 'u1', email: 'a@b.c', name: 'A', createdAt: new Date(0),
        profile: {
          cpf: '000.000.000-00', phone: '(41) 90000-0000',
          birthDate: new Date('1990-12-25T00:00:00.000Z'),
          city: 'Curitiba', uf: 'PR', bloodType: 'O-', allergies: 'Amendoim',
          avatarKey: 'avatars/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg',
        },
      },
    ])
    const [row] = await new UsersService(db, media()).listPending('org1')
    expect(row).toMatchObject({
      cpf: '000.000.000-00',
      phone: '(41) 90000-0000',
      birthDate: '1990-12-25T00:00:00.000Z',
      city: 'Curitiba',
      uf: 'PR',
      bloodType: 'O-',
      allergies: 'Amendoim',
    })
    expect(row.avatar).toContain('avatars/')
  })

  it('listPending() sem perfil preenchido devolve null (a tela é que decide o texto)', async () => {
    const db = prisma()
    db.user.findMany = jest.fn().mockResolvedValue([
      { id: 'u1', email: 'a@b.c', name: 'A', createdAt: new Date(0), profile: { cpf: '', bloodType: null } },
    ])
    const [row] = await new UsersService(db, media()).listPending('org1')
    expect(row.cpf).toBeNull()
    expect(row.bloodType).toBeNull()
    expect(row.avatar).toBe('')
  })

  it('reject() vira approvalStatus p/ REJECTED (mesma empresa)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.user.update.mockResolvedValue({ id: 'u1', approvalStatus: 'REJECTED' })
    const r = await new UsersService(db, media()).reject('u1', 'org1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { approvalStatus: 'REJECTED' } })
    expect(r.approvalStatus).toBe('REJECTED')
  })

  it('reject() de usuário de outra empresa → NotFound', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org2' })
    await expect(new UsersService(db, media()).reject('u1', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })

  // ---------------- list ----------------

  it('list() escopa por empresa e filtra role+approvalStatus, mapeando pro summary DTO', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([
      {
        id: 'u1',
        name: 'W1',
        email: 'w1@x.com',
        role: 'WORKER',
        approvalStatus: 'APPROVED',
        active: true,
        companyRole: null,
        createdAt: new Date(0),
        profile: {
          fullName: 'Worker Um',
          jobTitle: 'Operador',
          sector: 'Norte',
          bloodType: 'B+',
          birthDate: new Date('1990-05-04'),
          avatarKey: 'chat/av1.png',
        },
      },
    ])
    const svc = new UsersService(db, media())
    const r = await svc.list('org1', 'WORKER', 'APPROVED')
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { companyId: 'org1', role: 'WORKER', approvalStatus: 'APPROVED' },
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
      active: true,
      jobTitle: 'Operador',
      sector: 'Norte',
      bloodType: 'B+',
      birthDate: new Date('1990-05-04').toISOString(),
      avatar: 'signed:chat/av1.png',
      companyRole: null,
      createdAt: new Date(0).toISOString(),
    })
  })

  it('list() sem filtros ainda escopa pela empresa', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([])
    await new UsersService(db, media()).list('org1')
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { companyId: 'org1' },
      include: { profile: true },
      orderBy: { name: 'asc' },
      take: 200,
    })
  })

  it('list() com companyId null escopa o balde legado (companyId IS NULL)', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([])
    await new UsersService(db, media()).list(null)
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ companyId: null })
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
        active: false,
        companyRole: null,
        createdAt: new Date(0),
        profile: null,
      },
    ])
    const r = await new UsersService(db, media()).list('org1')
    expect(r[0]).toEqual({
      id: 'u2',
      name: 'W2',
      email: 'w2@x.com',
      role: 'WORKER',
      approvalStatus: 'PENDING',
      active: false,
      jobTitle: '',
      sector: '',
      // Sem profile → SEM tipo sanguíneo (null) — nunca um default universal.
      bloodType: null,
      birthDate: null,
      avatar: '',
      companyRole: null,
      createdAt: new Date(0).toISOString(),
    })
  })

  it('list() rejeita role inválido com BadRequest', async () => {
    const db = prisma()
    await expect(new UsersService(db, media()).list('org1', 'BOSS' as any)).rejects.toBeInstanceOf(BadRequestException)
  })

  // ---------------- getOne ----------------

  it('getOne() devolve detalhe com telefone, cpf e empresa (mesma org)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({
      id: 'a1',
      name: 'Adm',
      email: 'a@x.com',
      role: 'ADMIN',
      approvalStatus: 'APPROVED',
      active: true,
      companyId: 'c1',
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
    const r = await new UsersService(db, media()).getOne('a1', 'c1')
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
      active: true,
      jobTitle: 'Diretor',
      sector: 'Gestão',
      bloodType: null,
      birthDate: new Date('1980-01-02').toISOString(),
      avatar: 'signed:chat/adm.png',
      companyRole: 'owner',
      createdAt: new Date(0).toISOString(),
      phone: '11999',
      cpf: '12345',
      company: { id: 'c1', name: 'ACME' },
      // Cadastro clínico declaratório: null quando não preenchido. O detalhe do
      // painel caía num default fixo ("Gênero: Feminino" pra todo mundo) e
      // mostrava "Alergias" como título sem conteúdo (QA 2026-07-26).
      gender: null,
      allergies: null,
      chronicConditions: null,
    })
  })

  it('getOne() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db, media()).getOne('nope', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('getOne() de usuário de outra empresa → NotFound (não vaza detalhe)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'a1', companyId: 'org2', profile: null, company: null, createdAt: new Date(0) })
    await expect(new UsersService(db, media()).getOne('a1', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('UsersService.create', () => {
  it('cria User+Profile APPROVED/verificado com role e companyId do admin', async () => {
    const db = prisma()
    db.user.findUnique
      .mockResolvedValueOnce(null)                          // findByEmail: não existe
      .mockResolvedValueOnce({ id: 'adm', companyId: 'c1' }) // findById(admin)
    db.user.create.mockResolvedValue({ id: 'new', name: 'Zé', email: 'ze@x.com', role: 'WORKER', approvalStatus: 'APPROVED', active: true, companyRole: null, createdAt: new Date(0), profile: null })
    const svc = new UsersService(db, media())
    const created = await svc.create('adm', { name: 'Zé', email: 'ze@x.com', password: 'senha123', role: 'WORKER', phone: '11', cpf: '123', birthDate: '1990-05-04' })
    expect(created.active).toBe(true)
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
    db.user.create.mockResolvedValue({ id: 'n', name: 'Z', email: 'z@x.com', role: 'WORKER', approvalStatus: 'APPROVED', active: true, companyRole: null, createdAt: new Date(0), profile: null })
    await new UsersService(db, media()).create('adm', { name: 'Z', email: 'z@x.com', password: 'senha123', role: 'WORKER' })
    expect(db.user.create.mock.calls[0][0].data.companyId).toBeNull()
  })
})

describe('UsersService.setActive', () => {
  it('atualiza active (mesma empresa)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.user.update.mockResolvedValue({ id: 'u1', active: false })
    const r = await new UsersService(db, media()).setActive('u1', false, 'admin', 'org1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { active: false } })
    expect(r).toEqual({ id: 'u1', active: false })
  })
  it('desativar a si mesmo → BadRequest (sem tocar no banco)', async () => {
    const db = prisma()
    await expect(new UsersService(db, media()).setActive('me', false, 'me', 'org1')).rejects.toBeInstanceOf(BadRequestException)
    expect(db.user.update).not.toHaveBeenCalled()
  })
  it('reativar a si mesmo é permitido', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'me', companyId: 'org1' })
    db.user.update.mockResolvedValue({ id: 'me', active: true })
    const r = await new UsersService(db, media()).setActive('me', true, 'me', 'org1')
    expect(r).toEqual({ id: 'me', active: true })
  })
  it('alvo de outra empresa → NotFound sem tocar no update', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org2' })
    await expect(new UsersService(db, media()).setActive('u1', false, 'admin', 'org1')).rejects.toBeInstanceOf(NotFoundException)
    expect(db.user.update).not.toHaveBeenCalled()
  })
  it('id inexistente → NotFound', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db, media()).setActive('ghost', false, 'admin', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })
  it('corrida: P2025 do update ainda vira NotFound', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.user.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('nf', { code: 'P2025', clientVersion: 'x' }))
    await expect(new UsersService(db, media()).setActive('u1', false, 'admin', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('UsersService.remove', () => {
  it('excluir a si mesmo → BadRequest', async () => {
    await expect(new UsersService(prisma(), media()).remove('me', 'me', 'org1')).rejects.toBeInstanceOf(BadRequestException)
  })
  it('happy: apaga profile + user (mesma empresa)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.profile = { deleteMany: jest.fn().mockResolvedValue({}) }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    db.user.delete = jest.fn().mockResolvedValue({ id: 'u1' })
    await new UsersService(db, media()).remove('u1', 'admin', 'org1')
    expect(db.profile.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } })
  })
  it('alvo de outra empresa → NotFound sem apagar nada', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org2' })
    db.profile = { deleteMany: jest.fn() }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    await expect(new UsersService(db, media()).remove('u1', 'admin', 'org1')).rejects.toBeInstanceOf(NotFoundException)
    expect(db.profile.deleteMany).not.toHaveBeenCalled()
  })
  it('FK vinculada (P2003) → Conflict', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.profile = { deleteMany: jest.fn().mockResolvedValue({}) }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    db.user.delete = jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }))
    await expect(new UsersService(db, media()).remove('u1', 'admin', 'org1')).rejects.toBeInstanceOf(ConflictException)
  })
  it('id inexistente → NotFound', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    db.profile = { deleteMany: jest.fn() }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    await expect(new UsersService(db, media()).remove('ghost', 'admin', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })
})
