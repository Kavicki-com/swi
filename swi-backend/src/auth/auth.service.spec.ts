import bcrypt from 'bcrypt'
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common'
import { AuthService } from './auth.service'
import { DUMMY_HASH } from './codes'

function deps() {
  const users = { findByEmail: jest.fn(), findById: jest.fn(), approve: jest.fn() }
  const prisma = {
    user: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    company: { create: jest.fn(), delete: jest.fn() },
    profile: { deleteMany: jest.fn() },
  }
  const mail = {
    sendConfirmationCode: jest.fn().mockResolvedValue(undefined),
    sendResetCode: jest.fn().mockResolvedValue(undefined),
    sendAdminPasswordLink: jest.fn().mockResolvedValue(undefined),
  }
  const jwt = { sign: jest.fn().mockReturnValue('jwt-token') }
  const svc = new AuthService(prisma as any, users as any, mail as any, jwt as any)
  return { svc, users, prisma, mail, jwt }
}

// O "Alterar senha" do settings é endpoint autenticado: exige a senha ATUAL
// (verifyHash) antes de gravar a nova.
describe('AuthService.changePassword', () => {
  it('senha atual correta → grava o hash novo', async () => {
    const { svc, users, prisma } = deps()
    users.findById.mockResolvedValue({ id: 'u1', passwordHash: await bcrypt.hash('atual123', 4) })
    await svc.changePassword('u1', { currentPassword: 'atual123', newPassword: 'NovaSenha@2026' })
    const arg = prisma.user.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'u1' })
    expect(arg.data.passwordHash).toMatch(/^\$2[aby]\$/)
    expect(arg.data.passwordHash).not.toBe('NovaSenha@2026')
  })

  it('senha atual ERRADA → Unauthorized sem tocar no banco', async () => {
    const { svc, users, prisma } = deps()
    users.findById.mockResolvedValue({ id: 'u1', passwordHash: await bcrypt.hash('atual123', 4) })
    await expect(
      svc.changePassword('u1', { currentPassword: 'errada', newPassword: 'NovaSenha@2026' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('usuário inexistente (sessão órfã) → Unauthorized', async () => {
    const { svc, users } = deps()
    users.findById.mockResolvedValue(null)
    await expect(
      svc.changePassword('ghost', { currentPassword: 'x', newPassword: 'NovaSenha@2026' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})

describe('AuthService.signup', () => {
  it('cria worker pendente/não-verificado, gera código e manda e-mail', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'u1' })
    const r = await svc.signup({ email: 'joao@ex.com', password: 'senha123', name: 'João' })
    expect(r).toEqual({ nextStep: 'CONFIRM' })
    const data = prisma.user.create.mock.calls[0][0].data
    expect(data.email).toBe('joao@ex.com')
    expect(data.role).toBe('WORKER')
    expect(data.emailVerified).toBe(false)
    expect(data.approvalStatus).toBe('PENDING')
    expect(data.passwordHash).not.toBe('senha123')          // hasheada
    expect(mail.sendConfirmationCode).toHaveBeenCalledWith('joao@ex.com', expect.any(String))
  })

  it('lança Conflict se o e-mail já existe', async () => {
    const { svc, users } = deps()
    users.findByEmail.mockResolvedValue({ id: 'x' })
    await expect(svc.signup({ email: 'j@ex.com', password: 'p', name: 'J' }))
      .rejects.toBeInstanceOf(ConflictException)
  })
})

describe('AuthService.confirm', () => {
  it('valida o código, marca emailVerified e limpa o código', async () => {
    const { svc, users, prisma } = deps()
    const { hash } = await import('./codes')
    users.findByEmail.mockResolvedValue({
      id: 'u1', email: 'j@ex.com', emailVerified: false,
      confirmationCodeHash: await hash('123456'),
      confirmationExpires: new Date(Date.now() + 60_000),
    })
    prisma.user.update.mockResolvedValue({})
    await svc.confirm({ email: 'j@ex.com', code: '123456' })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailVerified: true, confirmationCodeHash: null, confirmationExpires: null },
    })
  })

  it('rejeita código errado', async () => {
    const { svc, users } = deps()
    const { hash } = await import('./codes')
    users.findByEmail.mockResolvedValue({
      id: 'u1', confirmationCodeHash: await hash('111111'),
      confirmationExpires: new Date(Date.now() + 60_000),
    })
    await expect(svc.confirm({ email: 'j@ex.com', code: '999999' })).rejects.toThrow()
  })
})

describe('AuthService.login (2 portas)', () => {
  const { hash } = jest.requireActual('./codes')
  async function userWith(over: any) {
    return { id: 'u1', email: 'j@ex.com', name: 'J', role: 'WORKER',
      passwordHash: await hash('senha123'), emailVerified: true, approvalStatus: 'APPROVED', active: true, ...over }
  }
  it('barra e-mail não verificado (403 reason confirme)', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(await userWith({ emailVerified: false }))
    await expect(svc.login({ email: 'j@ex.com', password: 'senha123' })).rejects.toMatchObject({ response: { reason: 'EMAIL_NOT_VERIFIED' } })
  })
  it('barra não aprovado (403 reason aprovação)', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(await userWith({ approvalStatus: 'PENDING' }))
    await expect(svc.login({ email: 'j@ex.com', password: 'senha123' })).rejects.toMatchObject({ response: { reason: 'NOT_APPROVED' } })
  })
  it('senha errada = 401', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(await userWith({}))
    await expect(svc.login({ email: 'j@ex.com', password: 'errada' })).rejects.toThrow()
  })
  it('barra usuário inativo (403 reason INACTIVE)', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(await userWith({ active: false }))
    await expect(svc.login({ email: 'j@ex.com', password: 'senha123' })).rejects.toMatchObject({ response: { reason: 'INACTIVE' } })
  })
  it('as 2 portas ok -> emite JWT + user', async () => {
    const { svc, users, jwt } = deps(); users.findByEmail.mockResolvedValue(await userWith({}))
    const r = await svc.login({ email: 'j@ex.com', password: 'senha123' })
    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', role: 'WORKER' })
    expect(r).toEqual({ accessToken: 'jwt-token', user: { id: 'u1', email: 'j@ex.com', name: 'J' } })
  })
})

describe('AuthService reset de senha', () => {
  it('forgot é sempre silencioso (não vaza e-mail inexistente)', async () => {
    const { svc, users, mail } = deps(); users.findByEmail.mockResolvedValue(null)
    await expect(svc.forgotPassword({ email: 'nao@existe.com' })).resolves.toBeUndefined()
    expect(mail.sendResetCode).not.toHaveBeenCalled()
  })
  it('forgot com usuário real gera código + e-mail', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', email: 'j@ex.com' }); prisma.user.update.mockResolvedValue({})
    await svc.forgotPassword({ email: 'j@ex.com' })
    expect(mail.sendResetCode).toHaveBeenCalledWith('j@ex.com', expect.any(String))
  })
  it('reset valida código e troca a senha', async () => {
    const { svc, users, prisma } = deps(); const { hash } = jest.requireActual('./codes')
    users.findByEmail.mockResolvedValue({ id: 'u1', resetCodeHash: await hash('123456'), resetExpires: new Date(Date.now() + 60_000) })
    prisma.user.update.mockResolvedValue({})
    await svc.resetPassword({ email: 'j@ex.com', code: '123456', newPassword: 'nova123' })
    const data = prisma.user.update.mock.calls[0][0].data
    expect(data.passwordHash).toBeDefined()
    expect(data.resetCodeHash).toBeNull()
  })
})

describe('AuthService.signup — perfil junto do cadastro', () => {
  // O app coleta dados pessoais, endereço e saúde ANTES de criar a conta, pra
  // que a fila de aprovação do painel já nasça completa. Sem isso o admin
  // aprovaria uma linha com nome e e-mail só.
  it('grava o que o worker preencheu, com birthDate virando Date', async () => {
    const { svc, users, prisma } = deps()
    users.findByEmail.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'u9' })
    await svc.signup({
      email: 'j@ex.com', password: 'p', name: 'João Silva',
      profile: {
        cpf: '000.000.000-00', phone: '(41) 90000-0000', birthDate: '1990-12-25',
        city: 'Curitiba', uf: 'PR', bloodType: 'O-', heightCm: 175, weightKg: 80,
        hasDisability: false,
      },
    })
    const created = prisma.user.create.mock.calls[0][0].data.profile.create
    expect(created).toMatchObject({
      fullName: 'João Silva',
      cpf: '000.000.000-00',
      city: 'Curitiba',
      bloodType: 'O-',
      heightCm: 175,
      hasDisability: false,
    })
    expect(created.birthDate).toBeInstanceOf(Date)
    expect(created.birthDate.toISOString()).toBe('1990-12-25T00:00:00.000Z')
  })

  it('sem perfil, o cadastro segue válido (build antiga do app / integrações)', async () => {
    const { svc, users, prisma } = deps()
    users.findByEmail.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'u9' })
    await svc.signup({ email: 'j@ex.com', password: 'p', name: 'J' })
    expect(prisma.user.create.mock.calls[0][0].data.profile.create).toEqual({ fullName: 'J' })
  })

  it('campo vazio não vira string vazia no banco (o wizard permite pular)', async () => {
    const { svc, users, prisma } = deps()
    users.findByEmail.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'u9' })
    await svc.signup({
      email: 'j@ex.com', password: 'p', name: 'J',
      profile: { cpf: '', allergies: undefined, bloodType: 'A+' },
    })
    const created = prisma.user.create.mock.calls[0][0].data.profile.create
    expect(created).not.toHaveProperty('cpf')
    expect(created).not.toHaveProperty('allergies')
    expect(created.bloodType).toBe('A+')
  })
})

describe('AuthService.signup rollback', () => {
  it('e-mail falha → deleta o User recém-criado e re-lança', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'u9' })
    ;(mail.sendConfirmationCode).mockRejectedValue(new Error('smtp down'))
    await expect(svc.signup({ email: 'j@ex.com', password: 'p', name: 'J' })).rejects.toThrow('smtp down')
    // Profile ANTES do user: a FK Profile para User não tem cascade, então
    // deletar o user primeiro estoura e deixa os dois órfãos.
    expect(prisma.profile.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u9' } })
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u9' } })
    const profileOrder = (prisma.profile.deleteMany).mock.invocationCallOrder[0]
    const userOrder = (prisma.user.delete).mock.invocationCallOrder[0]
    expect(profileOrder).toBeLessThan(userOrder)
  })
})

describe('AuthService.login timing-guard', () => {
  it('e-mail inexistente AINDA roda bcrypt.compare (anti-enumeração) e dá 401', async () => {
    const { svc, users } = deps()
    users.findByEmail.mockResolvedValue(null)
    const spy = jest.spyOn(bcrypt, 'compare')
    await expect(svc.login({ email: 'nao@existe.com', password: 'x' })).rejects.toBeInstanceOf(UnauthorizedException)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toBe(DUMMY_HASH)   // comparou contra o dummy, não um hash real
    spy.mockRestore()
  })
})

describe('AuthService expiração', () => {
  const { hash } = jest.requireActual('./codes')
  it('confirm com código expirado → BadRequest', async () => {
    const { svc, users } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', confirmationCodeHash: await hash('123456'), confirmationExpires: new Date(Date.now() - 1000) })
    await expect(svc.confirm({ email: 'j@ex.com', code: '123456' })).rejects.toBeInstanceOf(BadRequestException)
  })
  it('reset com código expirado → BadRequest', async () => {
    const { svc, users } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', resetCodeHash: await hash('123456'), resetExpires: new Date(Date.now() - 1000) })
    await expect(svc.resetPassword({ email: 'j@ex.com', code: '123456', newPassword: 'nova123' })).rejects.toBeInstanceOf(BadRequestException)
  })
  it('reset com código errado → throw', async () => {
    const { svc, users } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', resetCodeHash: await hash('111111'), resetExpires: new Date(Date.now() + 60_000) })
    await expect(svc.resetPassword({ email: 'j@ex.com', code: '999999', newPassword: 'nova123' })).rejects.toThrow()
  })
})

describe('AuthService enumeration-timing (H3a)', () => {
  it('confirm com e-mail inexistente AINDA roda bcrypt.compare (contra DUMMY_HASH) e dá BadRequest', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(null)
    const spy = jest.spyOn(bcrypt, 'compare')
    await expect(svc.confirm({ email: 'nao@existe.com', code: '123456' })).rejects.toBeInstanceOf(BadRequestException)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toBe(DUMMY_HASH)
    spy.mockRestore()
  })
  it('reset com e-mail inexistente AINDA roda bcrypt.compare (contra DUMMY_HASH) e dá BadRequest', async () => {
    const { svc, users } = deps(); users.findByEmail.mockResolvedValue(null)
    const spy = jest.spyOn(bcrypt, 'compare')
    await expect(svc.resetPassword({ email: 'nao@existe.com', code: '123456', newPassword: 'nova123' })).rejects.toBeInstanceOf(BadRequestException)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toBe(DUMMY_HASH)
    spy.mockRestore()
  })
  it('forgot com e-mail inexistente AINDA roda bcrypt.hash (trabalho dummy) e fica silencioso', async () => {
    const { svc, users, mail } = deps(); users.findByEmail.mockResolvedValue(null)
    const spy = jest.spyOn(bcrypt, 'hash')
    await expect(svc.forgotPassword({ email: 'nao@existe.com' })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)     // custo constante equivalente ao caminho real
    expect(mail.sendResetCode).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('AuthService.resendConfirmationCode', () => {
  it('usuário não-verificado → gera novo código, atualiza hash/expiração e reenvia o e-mail', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', email: 'j@ex.com', emailVerified: false })
    prisma.user.update.mockResolvedValue({})
    await svc.resendConfirmationCode({ email: 'j@ex.com' })
    const data = prisma.user.update.mock.calls[0][0].data
    expect(data.confirmationCodeHash).toBeDefined()
    expect(data.confirmationExpires).toBeInstanceOf(Date)
    expect(mail.sendConfirmationCode).toHaveBeenCalledWith('j@ex.com', expect.any(String))
  })

  it('e-mail inexistente → silencioso, sem e-mail (não vaza) e AINDA roda bcrypt.hash dummy (anti-enumeração)', async () => {
    const { svc, users, prisma, mail } = deps(); users.findByEmail.mockResolvedValue(null)
    const spy = jest.spyOn(bcrypt, 'hash')
    await expect(svc.resendConfirmationCode({ email: 'nao@existe.com' })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)     // custo constante equivalente ao caminho real
    expect(mail.sendConfirmationCode).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('usuário já verificado → silencioso, sem e-mail (não reenvia código a quem já confirmou)', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', email: 'j@ex.com', emailVerified: true })
    await expect(svc.resendConfirmationCode({ email: 'j@ex.com' })).resolves.toBeUndefined()
    expect(mail.sendConfirmationCode).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Onboarding de empresa + admin responsável (fatia feat/backend-admin-auth).
// A SignUp.tsx do painel é onboarding de empresa: cria Company + o responsável
// como ADMIN. A senha NÃO vem no form — o admin nasce sem senha usável,
// emailVerified=false, e recebe um LINK ("defina sua senha") que cai na mesma
// tela de nova senha e chama /auth/password/reset (código embutido no link).
// O link é o portão: mesmo APPROVED, sem e-mail verificado o login barra.
// ---------------------------------------------------------------------------
describe('AuthService.signupCompany', () => {
  const payload = () => ({
    company: {
      name: 'ACME Construções',
      cnpj: '00.000.000/0001-00',
      site: 'www.acme.com.br',
      cep: '30000-000',
      street: 'Avenida Quatro de Julho',
      number: '100',
      neighborhood: 'Pampulha',
      uf: 'MG',
    },
    responsible: { name: 'Maria', phone: '(31) 99999-0000', email: 'maria@acme.com', role: 'owner' },
  })

  it('cria Company + admin APPROVED/não-verificado, grava reset code e manda LINK de definir senha', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue(null)
    prisma.company.create.mockResolvedValue({ id: 'c1' })
    prisma.user.create.mockResolvedValue({ id: 'u1' })

    const r = await svc.signupCompany(payload())
    expect(r).toEqual({ nextStep: 'CHECK_EMAIL' })

    // Company persistida com os campos do form
    const cdata = prisma.company.create.mock.calls[0][0].data
    expect(cdata.name).toBe('ACME Construções')
    expect(cdata.cnpj).toBe('00.000.000/0001-00')
    expect(cdata.uf).toBe('MG')

    // Admin: ADMIN + APPROVED, mas emailVerified=false (link é o portão)
    const udata = prisma.user.create.mock.calls[0][0].data
    expect(udata.email).toBe('maria@acme.com')
    expect(udata.name).toBe('Maria')
    expect(udata.role).toBe('ADMIN')
    expect(udata.approvalStatus).toBe('APPROVED')
    expect(udata.emailVerified).toBe(false)
    expect(udata.companyId).toBe('c1')
    expect(udata.companyRole).toBe('owner')
    // senha placeholder inutilizável, mas o campo (NOT NULL) fica setado
    expect(typeof udata.passwordHash).toBe('string')
    expect(udata.passwordHash.length).toBeGreaterThan(0)
    // código de reset gravado (o mesmo que vai no link)
    expect(typeof udata.resetCodeHash).toBe('string')
    expect(udata.resetExpires).toBeInstanceOf(Date)
    // Telefone do responsável PERSISTE (era coletado no form, validado no DTO
    // e jogado fora — o cadastro perdia o único contato do admin).
    expect(udata.profile.create).toMatchObject({
      fullName: 'Maria',
      phone: '(31) 99999-0000',
    })

    // manda LINK (não código cru): url pra tela de nova senha, com email + code
    expect(mail.sendAdminPasswordLink).toHaveBeenCalledTimes(1)
    const [to, url] = mail.sendAdminPasswordLink.mock.calls[0]
    expect(to).toBe('maria@acme.com')
    expect(url).toContain('recovery/new-password?')
    expect(url).toMatch(/[?&]email=maria%40acme\.com/)
    expect(url).toMatch(/[?&]code=\d{6}/)
  })

  it('lança Conflict se o e-mail já existe e não cria Company nem admin', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue({ id: 'x' })
    await expect(svc.signupCompany(payload())).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.company.create).not.toHaveBeenCalled()
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(mail.sendAdminPasswordLink).not.toHaveBeenCalled()
  })

  it('e-mail falha → deleta admin e Company (sem órfãos) e re-lança', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue(null)
    prisma.company.create.mockResolvedValue({ id: 'c9' })
    prisma.user.create.mockResolvedValue({ id: 'u9' })
    ;(mail.sendAdminPasswordLink).mockRejectedValue(new Error('smtp down'))
    await expect(svc.signupCompany(payload())).rejects.toThrow('smtp down')
    // Profile PRIMEIRO: a FK Profile→User não tem cascade, então deletar o
    // user com o profile vivo estouraria e deixaria os dois órfãos.
    expect(prisma.profile.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u9' } })
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u9' } })
    expect(prisma.company.delete).toHaveBeenCalledWith({ where: { id: 'c9' } })
  })
})

describe('AuthService.resetPassword (destrava admin recém-criado)', () => {
  it('também marca emailVerified=true — provar posse do e-mail via código é o portão do admin', async () => {
    const { svc, users, prisma } = deps()
    const { hash } = jest.requireActual('./codes')
    users.findByEmail.mockResolvedValue({
      id: 'u1',
      resetCodeHash: await hash('123456'),
      resetExpires: new Date(Date.now() + 60_000),
    })
    prisma.user.update.mockResolvedValue({})
    await svc.resetPassword({ email: 'j@ex.com', code: '123456', newPassword: 'nova123' })
    const data = prisma.user.update.mock.calls[0][0].data
    expect(data.emailVerified).toBe(true)
  })
})

describe('AuthService.forgotPasswordAdmin (manda link, não código)', () => {
  it('e-mail inexistente → silencioso, sem link (não vaza) e AINDA roda bcrypt.hash dummy', async () => {
    const { svc, users, mail } = deps()
    users.findByEmail.mockResolvedValue(null)
    const spy = jest.spyOn(bcrypt, 'hash')
    await expect(svc.forgotPasswordAdmin({ email: 'nao@existe.com' })).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(mail.sendAdminPasswordLink).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('admin real → grava reset code e manda LINK com email + code', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue({ id: 'u1', email: 'a@swi.com' })
    prisma.user.update.mockResolvedValue({})
    await svc.forgotPasswordAdmin({ email: 'a@swi.com' })
    const data = prisma.user.update.mock.calls[0][0].data
    expect(typeof data.resetCodeHash).toBe('string')
    expect(data.resetExpires).toBeInstanceOf(Date)
    const [to, url] = mail.sendAdminPasswordLink.mock.calls[0]
    expect(to).toBe('a@swi.com')
    expect(url).toContain('recovery/new-password?')
    expect(url).toMatch(/[?&]code=\d{6}/)
  })
})
