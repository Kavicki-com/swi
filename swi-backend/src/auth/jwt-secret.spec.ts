import { requireJwtSecret } from './jwt-secret'

describe('requireJwtSecret', () => {
  const original = process.env.JWT_SECRET
  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = original
  })

  it('retorna o valor de JWT_SECRET quando definido', () => {
    process.env.JWT_SECRET = 'segredo-de-teste'
    expect(requireJwtSecret()).toBe('segredo-de-teste')
  })

  it('lança erro quando JWT_SECRET não está definido', () => {
    delete process.env.JWT_SECRET
    expect(() => requireJwtSecret()).toThrow('JWT_SECRET')
  })

  it('lança erro quando JWT_SECRET está vazio', () => {
    process.env.JWT_SECRET = ''
    expect(() => requireJwtSecret()).toThrow('JWT_SECRET')
  })

  // A força do segredo é a mesma regra do contrato de ambiente. Sem isto, um
  // segredo curto passava aqui e só o boot reclamava, e um processo que
  // recarregasse a estratégia sem passar pelo boot ficaria com o segredo fraco.
  it('recusa segredo curto em produção e aceita em desenvolvimento', () => {
    const originalNodeEnv = process.env.NODE_ENV
    try {
      process.env.JWT_SECRET = 'curto'
      process.env.NODE_ENV = 'production'
      expect(() => requireJwtSecret()).toThrow('JWT_SECRET')

      process.env.NODE_ENV = 'development'
      expect(requireJwtSecret()).toBe('curto')

      process.env.JWT_SECRET = 'x'.repeat(32)
      process.env.NODE_ENV = 'production'
      expect(requireJwtSecret()).toBe('x'.repeat(32))
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })
})
