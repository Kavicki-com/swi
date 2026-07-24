import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard'

// QA F (2026-07-24): o /support é público, mas logado deve vincular o userId —
// sem guard nenhum, req.user nunca existe (é o guard que popula). Este guard
// anexa o user quando o token vem válido e NUNCA bloqueia a request.
describe('OptionalJwtAuthGuard.handleRequest', () => {
  const guard = new OptionalJwtAuthGuard()

  it('token válido → devolve o user (popula req.user)', () => {
    const user = { userId: 'u1', role: 'ADMIN' }
    expect(guard.handleRequest(null, user)).toBe(user)
  })

  it('sem token → null, sem lançar (anônimo segue)', () => {
    expect(guard.handleRequest(null, false)).toBeNull()
  })

  it('token inválido/expirado → null, sem lançar (vira anônimo)', () => {
    expect(guard.handleRequest(new Error('jwt expired'), false)).toBeNull()
  })
})
