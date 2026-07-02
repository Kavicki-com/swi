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
})
