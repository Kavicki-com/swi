import bcrypt from 'bcrypt'
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common'
import { AuthService } from './auth.service'
import { DUMMY_HASH } from './codes'

function deps() {
  const users = { findByEmail: jest.fn(), findById: jest.fn(), approve: jest.fn() }
  const prisma = { user: { create: jest.fn(), update: jest.fn(), delete: jest.fn() } }
  const mail = { sendConfirmationCode: jest.fn().mockResolvedValue(undefined), sendResetCode: jest.fn().mockResolvedValue(undefined) }
  const jwt = { sign: jest.fn().mockReturnValue('jwt-token') }
  const svc = new AuthService(prisma as any, users as any, mail as any, jwt as any)
  return { svc, users, prisma, mail, jwt }
}

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
      passwordHash: await hash('senha123'), emailVerified: true, approvalStatus: 'APPROVED', ...over }
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

describe('AuthService.signup rollback', () => {
  it('e-mail falha → deleta o User recém-criado e re-lança', async () => {
    const { svc, users, prisma, mail } = deps()
    users.findByEmail.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'u9' })
    ;(mail.sendConfirmationCode as jest.Mock).mockRejectedValue(new Error('smtp down'))
    await expect(svc.signup({ email: 'j@ex.com', password: 'p', name: 'J' })).rejects.toThrow('smtp down')
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u9' } })
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
