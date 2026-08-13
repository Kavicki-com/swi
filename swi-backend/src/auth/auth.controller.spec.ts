import { AuthController } from './auth.controller'
import type { AuthService } from './auth.service'
import type { UsersService } from '../users/users.service'

// O que estes casos protegem não é o roteamento (isso é E2E), e sim a ligação
// entre entrada e serviço: qual método é chamado e com quais argumentos. A regra
// que mais importa aqui é a identidade vir do token (@CurrentUserId) e nunca do
// corpo: trocar isso deixaria um usuário mudar a senha de outro sem que nenhum
// teste de serviço percebesse.

const authService = () =>
  ({
    signup: jest.fn().mockResolvedValue({ ok: true }),
    confirm: jest.fn().mockResolvedValue({ ok: true }),
    resendConfirmationCode: jest.fn().mockResolvedValue({ ok: true }),
    login: jest.fn().mockResolvedValue({ accessToken: 't' }),
    forgotPassword: jest.fn().mockResolvedValue({ ok: true }),
    resetPassword: jest.fn().mockResolvedValue({ ok: true }),
    changePassword: jest.fn().mockResolvedValue({ ok: true }),
    signupCompany: jest.fn().mockResolvedValue({ ok: true }),
    forgotPasswordAdmin: jest.fn().mockResolvedValue({ ok: true }),
  }) as unknown as jest.Mocked<AuthService>

const usersService = () => ({ findById: jest.fn() }) as unknown as jest.Mocked<UsersService>

describe('AuthController', () => {
  it('encaminha cada rota pública ao método correspondente do serviço', async () => {
    const auth = authService()
    const c = new AuthController(auth, usersService())

    await c.signup({ email: 'a@ex.com', password: 'senha123', name: 'A' })
    await c.confirm({ email: 'a@ex.com', code: '123456' })
    await c.resend({ email: 'a@ex.com' })
    await c.login({ email: 'a@ex.com', password: 'senha123' })
    await c.forgot({ email: 'a@ex.com' })
    await c.reset({ email: 'a@ex.com', code: '1', password: 'nova12345' } as never)
    await c.signupCompany({ companyName: 'ACME' } as never)
    await c.forgotAdmin({ email: 'a@ex.com' })

    expect(auth.signup).toHaveBeenCalledWith({ email: 'a@ex.com', password: 'senha123', name: 'A' })
    expect(auth.confirm).toHaveBeenCalledWith({ email: 'a@ex.com', code: '123456' })
    expect(auth.resendConfirmationCode).toHaveBeenCalledWith({ email: 'a@ex.com' })
    expect(auth.login).toHaveBeenCalledWith({ email: 'a@ex.com', password: 'senha123' })
    expect(auth.forgotPassword).toHaveBeenCalledWith({ email: 'a@ex.com' })
    expect(auth.resetPassword).toHaveBeenCalledWith({ email: 'a@ex.com', code: '1', password: 'nova12345' })
    expect(auth.signupCompany).toHaveBeenCalledWith({ companyName: 'ACME' })
    expect(auth.forgotPasswordAdmin).toHaveBeenCalledWith({ email: 'a@ex.com' })
  })

  it('a troca de senha usa o id do token, não o corpo', async () => {
    const auth = authService()
    const c = new AuthController(auth, usersService())

    await c.change('do-token', { current: 'velha123', password: 'nova12345', userId: 'do-corpo' } as never)

    expect(auth.changePassword).toHaveBeenCalledWith('do-token', {
      current: 'velha123',
      password: 'nova12345',
      userId: 'do-corpo',
    })
  })

  it('/me devolve só id, email e nome do usuário do token', async () => {
    const users = usersService()
    users.findById.mockResolvedValue({
      id: 'u1',
      email: 'a@ex.com',
      name: 'A',
      passwordHash: 'nunca-deve-vazar',
      role: 'WORKER',
    } as never)
    const c = new AuthController(authService(), users)

    await expect(c.me('u1')).resolves.toEqual({ id: 'u1', email: 'a@ex.com', name: 'A' })
    expect(users.findById).toHaveBeenCalledWith('u1')
  })

  it('/me devolve null quando o usuário do token não existe mais', async () => {
    const users = usersService()
    users.findById.mockResolvedValue(null)

    await expect(new AuthController(authService(), users).me('sumiu')).resolves.toBeNull()
  })
})
