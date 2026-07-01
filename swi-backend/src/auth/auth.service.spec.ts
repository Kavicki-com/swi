import { ConflictException } from '@nestjs/common'
import { AuthService } from './auth.service'

function deps() {
  const users = { findByEmail: jest.fn(), findById: jest.fn(), approve: jest.fn() }
  const prisma = { user: { create: jest.fn(), update: jest.fn() } }
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
