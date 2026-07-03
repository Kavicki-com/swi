import * as bcrypt from 'bcrypt'
import { generateCode, hash, BCRYPT_COST, DUMMY_HASH } from './codes'

describe('generateCode (CSPRNG)', () => {
  it('sempre 6 dígitos', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/)
  })
})

describe('bcrypt cost', () => {
  it('BCRYPT_COST=12 e hash() usa esse cost', async () => {
    expect(BCRYPT_COST).toBe(12)
    expect((await hash('x')).startsWith('$2b$12$')).toBe(true)
  })
})

describe('DUMMY_HASH (guard de timing do login)', () => {
  it('é um bcrypt cost-12 válido e não bate com nada', () => {
    expect(DUMMY_HASH).toMatch(/^\$2[aby]\$12\$/)
    expect(bcrypt.compareSync('qualquer-senha', DUMMY_HASH)).toBe(false)
  })
})
