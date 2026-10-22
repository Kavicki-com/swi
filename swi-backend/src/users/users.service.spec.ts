import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { UsersService } from './users.service'

const prisma = () => ({ user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn() }, exam: { create: jest.fn(), deleteMany: jest.fn() } }) as any
// Espelha a convenção do work-orders.service.spec: presignGet devolve 'signed:<key>'.
const media = () => ({ presignGet: jest.fn((k: string) => Promise.resolve('signed:' + k)) }) as any
// Só o que o service usa do gateway: derrubar as conexões de quem perde o acesso.
const realtime = () => ({ disconnectUser: jest.fn() }) as any
// O que o create() usa do e-mail; o conteúdo do envio é provado no users.service.create.spec.
const mail = () => ({ sendPanelCredentials: jest.fn().mockResolvedValue(undefined) }) as any

// Escopo por empresa: TODA leitura e mutação de usuário é escopada pela empresa
// do requisitante, então uma empresa não enxerga nem mexe em usuários de outra.
// Alvo de outra empresa responde NotFound, para não vazar existência.

describe('UsersService', () => {
  it('approve() vira approvalStatus p/ APPROVED (mesma empresa)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.user.update.mockResolvedValue({ id: 'u1', approvalStatus: 'APPROVED' })
    const svc = new UsersService(db, media(), realtime(), mail())
    const r = await svc.approve('u1', 'org1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { approvalStatus: 'APPROVED' } })
    expect(r.approvalStatus).toBe('APPROVED')
  })

  it('approve() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db, media(), realtime(), mail()).approve('nope', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('approve() de usuário de OUTRA empresa → NotFound sem tocar no update', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org2' })
    await expect(new UsersService(db, media(), realtime(), mail()).approve('u1', 'org1')).rejects.toBeInstanceOf(NotFoundException)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('listPending() escopa por empresa além do PENDING', async () => {
    const db = prisma()
    db.user.findMany = jest.fn().mockResolvedValue([{ id: 'u1', email: 'a@b.c', name: 'A', createdAt: new Date(0) }])
    const r = await new UsersService(db, media(), realtime(), mail()).listPending('org1')
    const args = db.user.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ approvalStatus: 'PENDING', companyId: 'org1' })
    expect(args.orderBy).toEqual({ createdAt: 'asc' })
    expect(r).toHaveLength(1)
  })

  // O admin decide aprovar em cima destes campos. Uma fila que devolve só nome
  // e e-mail faz a aprovação acontecer às cegas.
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
    const [row] = await new UsersService(db, media(), realtime(), mail()).listPending('org1')
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
    const [row] = await new UsersService(db, media(), realtime(), mail()).listPending('org1')
    expect(row.cpf).toBeNull()
    expect(row.bloodType).toBeNull()
    expect(row.avatar).toBe('')
  })

  it('reject() vira approvalStatus p/ REJECTED (mesma empresa)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.user.update.mockResolvedValue({ id: 'u1', approvalStatus: 'REJECTED' })
    const r = await new UsersService(db, media(), realtime(), mail()).reject('u1', 'org1')
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { approvalStatus: 'REJECTED' } })
    expect(r.approvalStatus).toBe('REJECTED')
  })

  it('reject() de usuário de outra empresa → NotFound', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org2' })
    await expect(new UsersService(db, media(), realtime(), mail()).reject('u1', 'org1')).rejects.toBeInstanceOf(NotFoundException)
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
        monitoringPausedAt: new Date('2026-10-20T08:00:00.000Z'),
        companyRole: null,
        username: null,
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
    const svc = new UsersService(db, media(), realtime(), mail())
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
      // Alertas pausados no Monitoramento: o instante em que a pausa começou.
      monitoringPausedAt: '2026-10-20T08:00:00.000Z',
      jobTitle: 'Operador',
      sector: 'Norte',
      bloodType: 'B+',
      birthDate: new Date('1990-05-04').toISOString(),
      avatar: 'signed:chat/av1.png',
      companyRole: null,
      username: null,
      createdAt: new Date(0).toISOString(),
    })
  })

  it('list() sem filtros ainda escopa pela empresa', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([])
    await new UsersService(db, media(), realtime(), mail()).list('org1')
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
    await new UsersService(db, media(), realtime(), mail()).list(null)
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
        username: null,
        createdAt: new Date(0),
        profile: null,
      },
    ])
    const r = await new UsersService(db, media(), realtime(), mail()).list('org1')
    expect(r[0]).toEqual({
      id: 'u2',
      name: 'W2',
      email: 'w2@x.com',
      role: 'WORKER',
      approvalStatus: 'PENDING',
      active: false,
      monitoringPausedAt: null,
      jobTitle: '',
      sector: '',
      // Sem profile → SEM tipo sanguíneo (null) — nunca um default universal.
      bloodType: null,
      birthDate: null,
      avatar: '',
      companyRole: null,
      username: null,
      createdAt: new Date(0).toISOString(),
    })
  })

  // A tela de administradores lista os dois níveis do painel numa chamada só.
  it('list() aceita vários níveis separados por vírgula', async () => {
    const db = prisma()
    db.user.findMany.mockResolvedValue([])
    await new UsersService(db, media(), realtime(), mail()).list('org1', 'ADMIN,SUPERVISOR')
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ companyId: 'org1', role: { in: ['ADMIN', 'SUPERVISOR'] } })
  })

  it('list() com um nível inválido na lista → BadRequest', async () => {
    const db = prisma()
    await expect(new UsersService(db, media(), realtime(), mail()).list('org1', 'ADMIN,BOSS')).rejects.toBeInstanceOf(BadRequestException)
    expect(db.user.findMany).not.toHaveBeenCalled()
  })

  it('list() rejeita role inválido com BadRequest', async () => {
    const db = prisma()
    await expect(new UsersService(db, media(), realtime(), mail()).list('org1', 'BOSS' as any)).rejects.toBeInstanceOf(BadRequestException)
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
      username: null,
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
      exams: [],
    })
    const r = await new UsersService(db, media(), realtime(), mail()).getOne('a1', 'c1')
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'a1' },
      include: { profile: true, company: true, exams: { orderBy: { date: 'desc' } } },
    })
    expect(r).toEqual({
      id: 'a1',
      name: 'Admin Full',
      email: 'a@x.com',
      role: 'ADMIN',
      approvalStatus: 'APPROVED',
      active: true,
      monitoringPausedAt: null,
      jobTitle: 'Diretor',
      sector: 'Gestão',
      bloodType: null,
      birthDate: new Date('1980-01-02').toISOString(),
      avatar: 'signed:chat/adm.png',
      companyRole: 'owner',
      username: null,
      createdAt: new Date(0).toISOString(),
      phone: '11999',
      cpf: '12345',
      company: { id: 'c1', name: 'ACME' },
      // Cadastro clínico declaratório: null quando não preenchido. Com default
      // fixo o detalhe do painel atribuiria o mesmo gênero a todo mundo e
      // mostraria "Alergias" como título sem conteúdo.
      gender: null,
      allergies: null,
      chronicConditions: null,
      // Quem não tem exame sai com lista vazia, e o mock traz a chave porque o
      // Prisma SEMPRE devolve a relação incluída: não há fallback escondendo
      // include esquecido.
      exams: [],
    })
  })

  // O detalhe do painel já desenhava "Histórico de exames" (ExamInfoCard), mas o
  // DTO nunca trouxe os exames: a seção ficava vazia pra TODO mundo, mesmo com
  // exame cadastrado. Data de CALENDÁRIO ('AAAA-MM-DD') e não ISO datetime,
  // senão o dia recua um em fuso negativo na formatação da tela.
  it('getOne() devolve o histórico de exames com data de calendário e URL assinada', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({
      id: 'w1',
      name: 'Worker',
      email: 'w@x.com',
      role: 'WORKER',
      approvalStatus: 'APPROVED',
      active: true,
      companyId: 'c1',
      companyRole: null,
      username: null,
      createdAt: new Date(0),
      profile: null,
      company: null,
      exams: [
        { id: 'e1', name: 'Hemograma', date: new Date('2027-03-10T00:00:00.000Z'), fileKey: 'exams/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf' },
        { id: 'e2', name: 'Audiometria', date: new Date('2026-11-02T00:00:00.000Z'), fileKey: 'exams/11111111-2222-3333-4444-555555555555.jpg' },
      ],
    })
    const r = await new UsersService(db, media(), realtime(), mail()).getOne('w1', 'c1')
    // Mesma ordem do ProfileService.listExams, validade mais distante primeiro.
    // App e painel listando o MESMO histórico em ordens diferentes é problema
    // de confiança, não detalhe cosmético.
    expect(db.user.findUnique.mock.calls[0][0].include.exams).toEqual({ orderBy: { date: 'desc' } })
    // toEqual e não toMatchObject: correspondência PARCIAL por elemento deixaria
    // passar campo vazado por exame (o fileKey cru do storage ao lado do
    // fileUrl, por exemplo). Histórico clínico não é lugar de asserção frouxa.
    expect(r.exams).toEqual([
      { id: 'e1', name: 'Hemograma', date: '2027-03-10', fileUrl: 'signed:exams/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf' },
      { id: 'e2', name: 'Audiometria', date: '2026-11-02', fileUrl: 'signed:exams/11111111-2222-3333-4444-555555555555.jpg' },
    ])
  })

  it('getOne() de quem não tem exame devolve [], nunca undefined', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({
      id: 'w2', name: 'Sem Exame', email: 'w2@x.com', role: 'WORKER',
      approvalStatus: 'APPROVED', active: true, companyId: 'c1', companyRole: null,
      username: null,
      createdAt: new Date(0), profile: null, company: null, exams: [],
    })
    const r = await new UsersService(db, media(), realtime(), mail()).getOne('w2', 'c1')
    // toHaveProperty e não toMatchObject: undefined tem que reprovar, e não
    // passar despercebido como "campo opcional que a tela trata".
    expect(r).toHaveProperty('exams', [])
  })

  it('getOne() lança NotFound quando usuário não existe', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db, media(), realtime(), mail()).getOne('nope', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('getOne() de usuário de outra empresa → NotFound (não vaza detalhe)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'a1', companyId: 'org2', profile: null, company: null, createdAt: new Date(0) })
    await expect(new UsersService(db, media(), realtime(), mail()).getOne('a1', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('UsersService.create', () => {
  it('cria User+Profile APPROVED/verificado com role e companyId do admin', async () => {
    const db = prisma()
    db.user.findUnique
      .mockResolvedValueOnce(null)                          // findByEmail: não existe
      .mockResolvedValueOnce({ id: 'adm', companyId: 'c1' }) // findById(admin)
    db.user.create.mockResolvedValue({ id: 'new', name: 'Zé', email: 'ze@x.com', role: 'WORKER', approvalStatus: 'APPROVED', active: true, companyRole: null, createdAt: new Date(0), profile: null })
    const svc = new UsersService(db, media(), realtime(), mail())
    const created = await svc.create('adm', { name: 'Zé', email: 'ze@x.com', password: 'senha123', role: 'WORKER', phone: '11', cpf: '123', birthDate: '1990-05-04' })
    expect(created.active).toBe(true)
    const arg = db.user.create.mock.calls[0][0]
    expect(arg.data).toMatchObject({ name: 'Zé', email: 'ze@x.com', role: 'WORKER', approvalStatus: 'APPROVED', emailVerified: true, companyId: 'c1' })
    expect(arg.data.passwordHash).toBeTruthy()
    expect(arg.data.passwordHash).not.toBe('senha123')      // nunca senha em texto puro
    expect(arg.data.passwordHash).toMatch(/^\$2[aby]\$/)     // formato bcrypt
    expect(arg.data.profile.create).toMatchObject({ fullName: 'Zé', phone: '11', cpf: '123', birthDate: new Date('1990-05-04') })
  })
  it('cria supervisor com o nível pedido', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'adm', companyId: 'c1' })
    db.user.create.mockResolvedValue({ id: 'new', name: 'Sil', email: 's@x.com', role: 'SUPERVISOR', approvalStatus: 'APPROVED', active: true, companyRole: null, createdAt: new Date(0), profile: null })
    const created = await new UsersService(db, media(), realtime(), mail()).create('adm', { name: 'Sil', email: 's@x.com', password: 'Senha@2026', role: 'SUPERVISOR' })
    expect(db.user.create.mock.calls[0][0].data.role).toBe('SUPERVISOR')
    expect(created.role).toBe('SUPERVISOR')
  })

  it('email já cadastrado → ConflictException', async () => {
    const db = prisma(); db.user.findUnique.mockResolvedValueOnce({ id: 'x' })
    await expect(new UsersService(db, media(), realtime(), mail()).create('adm', { name: 'Z', email: 'z@x.com', password: 'senha123', role: 'WORKER' })).rejects.toBeInstanceOf(ConflictException)
  })
  it('corrida: P2002 do create vira ConflictException', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'adm', companyId: 'c1' })
    db.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }))
    await expect(new UsersService(db, media(), realtime(), mail()).create('adm', { name: 'Z', email: 'z@x.com', password: 'senha123', role: 'WORKER' })).rejects.toBeInstanceOf(ConflictException)
  })
  it('admin sem empresa → companyId null', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'adm', companyId: null })
    db.user.create.mockResolvedValue({ id: 'n', name: 'Z', email: 'z@x.com', role: 'WORKER', approvalStatus: 'APPROVED', active: true, companyRole: null, createdAt: new Date(0), profile: null })
    await new UsersService(db, media(), realtime(), mail()).create('adm', { name: 'Z', email: 'z@x.com', password: 'senha123', role: 'WORKER' })
    expect(db.user.create.mock.calls[0][0].data.companyId).toBeNull()
  })
})

// PATCH /users/:id só aceitava { active }. Com isso o painel não tinha como
// editar um funcionário nem um administrador, e os "Dados de saúde" digitados
// no cadastro eram descartados no submit: o formulário mostrava campos que não
// iam a lugar nenhum. Este patch cobre identidade + perfil declaratório.
//
// Fora do alcance de propósito: email e role. O ValidationPipe global roda com
// whitelist, então campo não declarado no DTO é removido do corpo, e trocar
// e-mail (identidade de login) ou papel exige fluxo próprio, não um PATCH de
// cadastro.
describe('UsersService.update', () => {
  const alvo = { id: 'u1', companyId: 'org1', active: true }
  const salvo = (over = {}) => ({ id: 'u1', name: 'Ana', email: 'a@b.c', role: 'WORKER', approvalStatus: 'APPROVED', active: true, companyRole: null, createdAt: new Date('2026-01-05T00:00:00Z'), profile: null, ...over })

  it('grava nome no User e espelha no Profile por upsert', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(alvo)
    db.user.update.mockResolvedValue(salvo())
    await new UsersService(db, media(), realtime(), mail()).update('u1', { name: 'Ana Maria' }, 'admin', 'org1')
    const arg = db.user.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'u1' })
    expect(arg.data.name).toBe('Ana Maria')
    // upsert, não update: quem nunca preencheu o perfil não tem linha em
    // Profile, e um update puro estouraria P2025 no primeiro save.
    expect(arg.data.profile.upsert.create.fullName).toBe('Ana Maria')
    expect(arg.data.profile.upsert.update.fullName).toBe('Ana Maria')
  })

  // O buraco relatado na auditoria: tipo sanguíneo, gênero, alergias e doenças
  // crônicas eram renderizados no cadastro e jogados fora no submit.
  it('persiste os dados de saúde declaratórios do cadastro', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(alvo)
    db.user.update.mockResolvedValue(salvo())
    await new UsersService(db, media(), realtime(), mail()).update(
      'u1',
      { gender: 'Feminino', bloodType: 'O-', allergies: 'Dipirona', chronicConditions: 'Asma' },
      'admin',
      'org1',
    )
    expect(db.user.update.mock.calls[0][0].data.profile.upsert.update).toEqual(
      expect.objectContaining({ gender: 'Feminino', bloodType: 'O-', allergies: 'Dipirona', chronicConditions: 'Asma' }),
    )
  })

  it('birthDate ISO vira Date no Profile', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(alvo)
    db.user.update.mockResolvedValue(salvo())
    await new UsersService(db, media(), realtime(), mail()).update('u1', { birthDate: '1990-05-04' }, 'admin', 'org1')
    expect(db.user.update.mock.calls[0][0].data.profile.upsert.update.birthDate).toEqual(new Date('1990-05-04'))
  })

  // Compatibilidade: o toggle do painel manda exatamente este corpo hoje.
  it('{ active: false } continua desativando, e sem escrever perfil', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(alvo)
    db.user.update.mockResolvedValue(salvo({ active: false }))
    const r = await new UsersService(db, media(), realtime(), mail()).update('u1', { active: false }, 'admin', 'org1')
    const arg = db.user.update.mock.calls[0][0]
    expect(arg.data.active).toBe(false)
    expect(arg.data.profile).toBeUndefined() // nada de perfil quando nenhum campo de perfil veio
    expect(r).toEqual(expect.objectContaining({ id: 'u1', active: false }))
  })

  it('desativar a si mesmo → BadRequest, sem tocar no banco', async () => {
    const db = prisma()
    await expect(
      new UsersService(db, media(), realtime(), mail()).update('me', { active: false }, 'me', 'org1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('reativar a si mesmo é permitido', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'me', companyId: 'org1' })
    db.user.update.mockResolvedValue(salvo({ id: 'me', active: true }))
    await expect(
      new UsersService(db, media(), realtime(), mail()).update('me', { active: true }, 'me', 'org1'),
    ).resolves.toEqual(expect.objectContaining({ active: true }))
  })

  // ---- nível (Administrador ↔ Supervisor) ----
  it('troca o nível de um administrador para supervisor', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ ...alvo, role: 'ADMIN' })
    db.user.update.mockResolvedValue(salvo({ role: 'SUPERVISOR' }))
    const out = await new UsersService(db, media(), realtime(), mail()).update('u1', { role: 'SUPERVISOR' }, 'admin', 'org1')
    expect(db.user.update.mock.calls[0][0].data).toEqual({ role: 'SUPERVISOR' })
    expect(out.role).toBe('SUPERVISOR')
  })

  it('troca o nível de um supervisor para administrador', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ ...alvo, role: 'SUPERVISOR' })
    db.user.update.mockResolvedValue(salvo({ role: 'ADMIN' }))
    await new UsersService(db, media(), realtime(), mail()).update('u1', { role: 'ADMIN' }, 'admin', 'org1')
    expect(db.user.update.mock.calls[0][0].data).toEqual({ role: 'ADMIN' })
  })

  it('funcionário não ganha nível do painel pela edição → BadRequest, sem gravar', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ ...alvo, role: 'WORKER' })
    await expect(
      new UsersService(db, media(), realtime(), mail()).update('u1', { role: 'ADMIN' }, 'admin', 'org1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  // Sem esta guarda o único administrador se rebaixaria e a empresa ficaria
  // sem ninguém que gerencie usuários.
  it('mudar o próprio nível → BadRequest, sem tocar no banco', async () => {
    const db = prisma()
    await expect(
      new UsersService(db, media(), realtime(), mail()).update('me', { role: 'SUPERVISOR' }, 'me', 'org1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('alvo de OUTRA empresa → NotFound sem tocar no update', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org2' })
    await expect(
      new UsersService(db, media(), realtime(), mail()).update('u1', { name: 'X' }, 'admin', 'org1'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('corpo vazio não inventa escrita de perfil', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(alvo)
    db.user.update.mockResolvedValue(salvo())
    await new UsersService(db, media(), realtime(), mail()).update('u1', {}, 'admin', 'org1')
    expect(db.user.update.mock.calls[0][0].data.profile).toBeUndefined()
  })

  // O DTO deixa null passar nos campos de perfil (@IsOptional pula null), e a
  // régua da casa (PUT /profile/me) é: null em string anulável LIMPA, null em
  // data é IGNORADO, porque new Date(null) fabricaria `1970-01-01` num registro
  // de segurança.
  it('birthDate null é ignorado, nunca vira 1970-01-01', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(alvo)
    db.user.update.mockResolvedValue(salvo())
    await new UsersService(db, media(), realtime(), mail()).update('u1', { birthDate: null } as never, 'admin', 'org1')
    expect(db.user.update.mock.calls[0][0].data.profile).toBeUndefined()
  })

  it('null em string anulável limpa o campo (paridade com o PUT /profile/me)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(alvo)
    db.user.update.mockResolvedValue(salvo())
    await new UsersService(db, media(), realtime(), mail()).update('u1', { allergies: null } as never, 'admin', 'org1')
    expect(db.user.update.mock.calls[0][0].data.profile.upsert.update.allergies).toBeNull()
  })

  it('campos de endereço chegam ao Profile', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(alvo)
    db.user.update.mockResolvedValue(salvo())
    await new UsersService(db, media(), realtime(), mail()).update(
      'u1',
      { cep: '01310-100', street: 'Av. Paulista', number: '1000', complement: 'Bloco B', neighborhood: 'Bela Vista', city: 'São Paulo', uf: 'SP' },
      'admin',
      'org1',
    )
    expect(db.user.update.mock.calls[0][0].data.profile.upsert.update).toEqual(
      expect.objectContaining({ cep: '01310-100', street: 'Av. Paulista', number: '1000', complement: 'Bloco B', neighborhood: 'Bela Vista', city: 'São Paulo', uf: 'SP' }),
    )
  })
})

// O buraco que motivou a ampliação do PATCH morava no CREATE: o cadastro do
// painel renderizava "Dados de saúde" e o payload os descartava. Agora eles
// persistem no Profile já na criação.
describe('UsersService.create com dados de saúde', () => {
  it('persiste gender/bloodType/allergies/chronicConditions no profile.create', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null) // pré-check de e-mail
    db.user.create.mockResolvedValue({
      id: 'u9', name: 'Ana', email: 'ana@empresa.com.br', role: 'WORKER', approvalStatus: 'APPROVED',
      active: true, companyRole: null, createdAt: new Date('2026-01-05T00:00:00Z'), profile: null,
    })
    await new UsersService(db, media(), realtime(), mail()).create('admin', {
      name: 'Ana', email: 'ana@empresa.com.br', password: 'senha-forte', role: 'WORKER',
      gender: 'Feminino', bloodType: 'O-', allergies: 'Dipirona', chronicConditions: 'Asma',
    })
    expect(db.user.create.mock.calls[0][0].data.profile.create).toEqual(
      expect.objectContaining({ gender: 'Feminino', bloodType: 'O-', allergies: 'Dipirona', chronicConditions: 'Asma' }),
    )
  })
})

// Garantias herdadas do antigo setActive, que o update absorveu quando o PATCH
// deixou de ser só o toggle de ativação. Ficam aqui para que remover a tradução
// de erro por engano quebre um teste, e não a produção.
describe('UsersService.update: herança do setActive', () => {
  it('id inexistente → NotFound', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    await expect(new UsersService(db, media(), realtime(), mail()).update('ghost', { active: false }, 'admin', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })
  it('corrida: P2025 do update ainda vira NotFound', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.user.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('nf', { code: 'P2025', clientVersion: 'x' }))
    await expect(new UsersService(db, media(), realtime(), mail()).update('u1', { active: false }, 'admin', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('UsersService.remove', () => {
  it('excluir a si mesmo → BadRequest', async () => {
    await expect(new UsersService(prisma(), media(), realtime(), mail()).remove('me', 'me', 'org1')).rejects.toBeInstanceOf(BadRequestException)
  })
  it('happy: apaga profile + user (mesma empresa)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.profile = { deleteMany: jest.fn().mockResolvedValue({}) }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    db.user.delete = jest.fn().mockResolvedValue({ id: 'u1' })
    await new UsersService(db, media(), realtime(), mail()).remove('u1', 'admin', 'org1')
    expect(db.profile.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } })
  })
  it('alvo de outra empresa → NotFound sem apagar nada', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org2' })
    db.profile = { deleteMany: jest.fn() }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    await expect(new UsersService(db, media(), realtime(), mail()).remove('u1', 'admin', 'org1')).rejects.toBeInstanceOf(NotFoundException)
    expect(db.profile.deleteMany).not.toHaveBeenCalled()
  })
  it('FK vinculada (P2003) → Conflict', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.profile = { deleteMany: jest.fn().mockResolvedValue({}) }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    db.user.delete = jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }))
    await expect(new UsersService(db, media(), realtime(), mail()).remove('u1', 'admin', 'org1')).rejects.toBeInstanceOf(ConflictException)
  })
  it('id inexistente → NotFound', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    db.profile = { deleteMany: jest.fn() }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    await expect(new UsersService(db, media(), realtime(), mail()).remove('ghost', 'admin', 'org1')).rejects.toBeInstanceOf(NotFoundException)
  })
})

// Exame anexado PELO ADMIN a outra pessoa. Até aqui só existia POST
// /profile/exams, que grava sempre no usuário da sessão: o admin cadastrando
// alguém não tinha como anexar o laudo dessa pessoa, e a seção de exames do
// formulário aceitava o arquivo e não o mandava a lugar nenhum.
describe('UsersService.addExam', () => {
  const dto = { name: 'Hemograma', date: '2027-03-14', fileKey: 'exams/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf' }

  it('grava no usuário da ROTA e devolve o exame já apresentável', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.exam.create.mockResolvedValue({
      id: 'e1',
      userId: 'u1',
      name: 'Hemograma',
      date: new Date('2027-03-14T00:00:00.000Z'),
      fileKey: dto.fileKey,
    })

    const r = await new UsersService(db, media(), realtime(), mail()).addExam('u1', dto, 'org1')

    // userId sai da rota, e a validade vira Date porque a coluna é @db.Date.
    expect(db.exam.create).toHaveBeenCalledWith({
      data: { userId: 'u1', name: 'Hemograma', date: new Date('2027-03-14'), fileKey: dto.fileKey },
    })
    // Mesma forma que o detalhe do usuário já devolve: data de CALENDÁRIO (ISO
    // com hora recuaria o dia em fuso negativo) e URL assinada, nunca a key.
    expect(r).toEqual({
      id: 'e1',
      name: 'Hemograma',
      date: '2027-03-14',
      fileUrl: 'signed:' + dto.fileKey,
    })
  })

  it('usuário de OUTRA empresa → NotFound sem gravar nada', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org2' })

    await expect(new UsersService(db, media(), realtime(), mail()).addExam('u1', dto, 'org1')).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(db.exam.create).not.toHaveBeenCalled()
  })

  it('usuário inexistente → NotFound sem gravar nada', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)

    await expect(new UsersService(db, media(), realtime(), mail()).addExam('nope', dto, 'org1')).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(db.exam.create).not.toHaveBeenCalled()
  })
})

// Exclusão de exame PELO ADMIN do cadastro de outra pessoa. Até aqui só existia
// DELETE /profile/exams/:id, que apaga no usuário da sessão: o admin não tinha
// como tirar um laudo do cadastro de quem edita.
describe('UsersService.removeExam', () => {
  it('apaga o exame do usuário da rota e diz que apagou', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.exam.deleteMany.mockResolvedValue({ count: 1 })

    const ok = await new UsersService(db, media(), realtime(), mail()).removeExam('u1', 'e1', 'org1')

    // deleteMany com id E userId no filtro: um exame de outra pessoa não é
    // apagado nem por engano (mesma defesa do ProfileService.removeExam).
    expect(db.exam.deleteMany).toHaveBeenCalledWith({ where: { id: 'e1', userId: 'u1' } })
    expect(ok).toBe(true)
  })

  it('exame inexistente (ou de outro usuário) devolve false', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.exam.deleteMany.mockResolvedValue({ count: 0 })

    const ok = await new UsersService(db, media(), realtime(), mail()).removeExam('u1', 'nope', 'org1')
    expect(ok).toBe(false)
  })

  it('usuário de OUTRA empresa → NotFound sem apagar nada', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org2' })

    await expect(
      new UsersService(db, media(), realtime(), mail()).removeExam('u1', 'e1', 'org1'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(db.exam.deleteMany).not.toHaveBeenCalled()
  })
})

// Username no create/update: gravado no User (identidade de conta, como o
// e-mail), único no banco, e colisão traduzida pra 409 legível.
describe('UsersService: username', () => {
  it('create grava o username no User quando informado', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    db.user.create.mockResolvedValue({ id: 'n1', createdAt: new Date(), profile: null })
    await new UsersService(db, media(), realtime(), mail()).create('admin-1', {
      name: 'Zé', email: 'ze@x.com', password: 's3nh4!123', role: 'WORKER', username: 'ze.silva',
    } as never)
    expect(db.user.create.mock.calls[0][0].data.username).toBe('ze.silva')
  })

  it('create sem username não manda a chave (fica NULL, fora do índice único)', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    db.user.create.mockResolvedValue({ id: 'n1', createdAt: new Date(), profile: null })
    await new UsersService(db, media(), realtime(), mail()).create('admin-1', {
      name: 'Zé', email: 'ze@x.com', password: 's3nh4!123', role: 'WORKER',
    } as never)
    expect(db.user.create.mock.calls[0][0].data).not.toHaveProperty('username')
  })

  it('username já em uso vira 409 com mensagem própria, não a de e-mail', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue(null)
    db.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002', clientVersion: 'x', meta: { target: ['username'] },
      }),
    )
    await expect(
      new UsersService(db, media(), realtime(), mail()).create('admin-1', {
        name: 'Zé', email: 'ze@x.com', password: 's3nh4!123', role: 'WORKER', username: 'ze.silva',
      } as never),
    ).rejects.toMatchObject({ message: 'Nome de usuário já em uso' })
  })

  it('update grava username no User e colisão também vira o 409 próprio', async () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.user.update.mockResolvedValue({ id: 'u1', profile: null, createdAt: new Date() })
    const svc = new UsersService(db, media(), realtime(), mail())
    await svc.update('u1', { username: 'ana_2' }, 'admin-1', 'org1')
    expect(db.user.update.mock.calls[0][0].data.username).toBe('ana_2')

    db.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002', clientVersion: 'x', meta: { target: ['username'] },
      }),
    )
    await expect(svc.update('u1', { username: 'ana_2' }, 'admin-1', 'org1')).rejects.toMatchObject({
      message: 'Nome de usuário já em uso',
    })
  })
})

// O REST barra o desativado a cada requisição; o socket só confere ao conectar.
// Sem derrubar a conexão aberta, um admin desativado com o painel aberto
// seguiria recebendo a telemetria de todos até o socket cair sozinho.
describe('UsersService: conexões abertas de quem perde o acesso', () => {
  const salvo = (over = {}) => ({ id: 'u1', name: 'Ana', email: 'a@b.c', role: 'WORKER', approvalStatus: 'APPROVED', active: true, companyRole: null, createdAt: new Date('2026-01-05T00:00:00Z'), profile: null, ...over })
  const daMesmaEmpresa = () => {
    const db = prisma()
    db.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'org1' })
    db.profile = { deleteMany: jest.fn().mockResolvedValue({}) }
    db.$transaction = jest.fn(async (fn: any) => fn(db))
    return db
  }

  it('desativar derruba as conexões do usuário, depois de gravar', async () => {
    const db = daMesmaEmpresa()
    db.user.update.mockResolvedValue(salvo({ active: false }))
    const rt = realtime()
    await new UsersService(db, media(), rt, mail()).update('u1', { active: false }, 'admin', 'org1')
    expect(rt.disconnectUser).toHaveBeenCalledWith('u1')
    expect(db.user.update.mock.invocationCallOrder[0]).toBeLessThan(rt.disconnectUser.mock.invocationCallOrder[0])
  })

  it('editar ou reativar não derruba ninguém', async () => {
    const db = daMesmaEmpresa()
    db.user.update.mockResolvedValue(salvo())
    const rt = realtime()
    const svc = new UsersService(db, media(), rt, mail())
    await svc.update('u1', { name: 'Ana B' }, 'admin', 'org1')
    await svc.update('u1', { active: true }, 'admin', 'org1')
    expect(rt.disconnectUser).not.toHaveBeenCalled()
  })

  it('desativação que o banco recusa não derruba', async () => {
    const db = daMesmaEmpresa()
    db.user.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('sumiu', { code: 'P2025', clientVersion: 'x' }))
    const rt = realtime()
    await expect(
      new UsersService(db, media(), rt, mail()).update('u1', { active: false }, 'admin', 'org1'),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(rt.disconnectUser).not.toHaveBeenCalled()
  })

  it('excluir derruba as conexões do usuário, depois de apagar', async () => {
    const db = daMesmaEmpresa()
    db.user.delete.mockResolvedValue({ id: 'u1' })
    const rt = realtime()
    await new UsersService(db, media(), rt, mail()).remove('u1', 'admin', 'org1')
    expect(rt.disconnectUser).toHaveBeenCalledWith('u1')
    expect(db.user.delete.mock.invocationCallOrder[0]).toBeLessThan(rt.disconnectUser.mock.invocationCallOrder[0])
  })

  // A escrita já foi gravada quando o socket é derrubado. Responder 500 ali
  // diria ao admin que a desativação falhou, com a pessoa já desativada.
  it('falha ao derrubar o socket não desfaz nem reprova a desativação e a exclusão', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const db = daMesmaEmpresa()
    db.user.update.mockResolvedValue(salvo({ active: false }))
    db.user.delete.mockResolvedValue({ id: 'u1' })
    const rt = { disconnectUser: jest.fn(() => { throw new Error('gateway fora') }) } as any
    const svc = new UsersService(db, media(), rt, mail())

    await expect(svc.update('u1', { active: false }, 'admin', 'org1')).resolves.toEqual(
      expect.objectContaining({ active: false }),
    )
    await expect(svc.remove('u1', 'admin', 'org1')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  // Quem tem histórico não é excluído (409) e continua ativo: a conexão fica.
  it('exclusão recusada não derruba', async () => {
    const db = daMesmaEmpresa()
    db.user.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }))
    const rt = realtime()
    await expect(new UsersService(db, media(), rt, mail()).remove('u1', 'admin', 'org1')).rejects.toBeInstanceOf(ConflictException)
    expect(rt.disconnectUser).not.toHaveBeenCalled()
  })
})
