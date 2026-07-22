import { UnauthorizedException } from '@nestjs/common'
import { JwtStrategy } from './jwt.strategy'

// A estratégia agora reconsulta o banco a cada request autenticada: desativar/
// excluir um usuário revoga a sessão na hora (antes o payload do token valia por
// até 7 dias). A role também passa a vir fresca do banco, não do token.
describe('JwtStrategy.validate', () => {
  const usersWith = (u: any) => ({ findById: jest.fn().mockResolvedValue(u) }) as any
  beforeAll(() => { process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret' })

  it('user ativo → {userId, role} com role fresca do banco (ignora a role do token)', async () => {
    const s = new JwtStrategy(usersWith({ id: 'u1', role: 'ADMIN', active: true }))
    const r = await s.validate({ sub: 'u1', role: 'WORKER' })
    expect(r).toEqual({ userId: 'u1', role: 'ADMIN' })
  })

  it('user inativo → UnauthorizedException (sessão revogada)', async () => {
    const s = new JwtStrategy(usersWith({ id: 'u1', role: 'WORKER', active: false }))
    await expect(s.validate({ sub: 'u1', role: 'WORKER' })).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('user inexistente (excluído) → UnauthorizedException', async () => {
    const s = new JwtStrategy(usersWith(null))
    await expect(s.validate({ sub: 'ghost', role: 'WORKER' })).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
