import {
  isEmail,
  minLength,
  requiredText,
  matches,
  newPasswordProblem,
  PASSWORD_LENGTH_MESSAGE,
  PASSWORD_RULE_MESSAGE,
} from './validators'

describe('isEmail', () => {
  it('accepts a normal email', () => {
    expect(isEmail('admin@swi.test')).toBe(true)
  })
  it('rejects missing @', () => {
    expect(isEmail('admin.swi.test')).toBe(false)
  })
  it('rejects empty string', () => {
    expect(isEmail('')).toBe(false)
  })
  it('accepts unicode local part (Portuguese)', () => {
    expect(isEmail('olá@b.co')).toBe(true)
  })
  it('rejects leading dot in local part', () => {
    expect(isEmail('.admin@swi.test')).toBe(false)
  })
  it('rejects consecutive dots', () => {
    expect(isEmail('admin@swi..test')).toBe(false)
  })
  it('rejects email without TLD', () => {
    expect(isEmail('a@b')).toBe(false)
  })
})

describe('minLength', () => {
  it('passes when string has at least N chars', () => {
    expect(minLength('abcdefgh', 8)).toBe(true)
  })
  it('fails when shorter', () => {
    expect(minLength('abc', 8)).toBe(false)
  })
  it('fails one short of boundary', () => {
    expect(minLength('abcdefg', 8)).toBe(false)
  })
  it('treats empty string as valid for n=0', () => {
    expect(minLength('', 0)).toBe(true)
  })
})

describe('requiredText', () => {
  it('rejects empty and whitespace-only', () => {
    expect(requiredText('')).toBe(false)
    expect(requiredText('   ')).toBe(false)
  })
  it('accepts trimmed non-empty', () => {
    expect(requiredText('a')).toBe(true)
  })
})

describe('matches', () => {
  it('returns true when both are equal', () => {
    expect(matches('hunter2', 'hunter2')).toBe(true)
  })
  it('returns false when different', () => {
    expect(matches('hunter2', 'hunter3')).toBe(false)
  })
  it('returns true when both are empty', () => {
    expect(matches('', '')).toBe(true)
  })
})

// Espelho de swi-backend/src/auth/password-rule.ts. A tela recusa o que o
// servidor recusaria, com a mesma mensagem, e aprova o que ele aprova.
describe('newPasswordProblem', () => {
  it('aceita a senha que cumpre a regra inteira', () => {
    expect(newPasswordProblem('Senha@2026')).toBeNull()
  })

  it('aceita senha sem letra minúscula', () => {
    expect(newPasswordProblem('ABCDEF1@')).toBeNull()
  })

  it.each(['Senha!2026', 'Senha&2026', 'Senha-2026', 'Senha_2026', 'Senha.2026'])(
    'aceita símbolo fora da lista do quadro: %s',
    (senha) => {
      expect(newPasswordProblem(senha)).toBeNull()
    },
  )

  it.each([
    ['curta', 'Se@2026'],
    ['sem número', 'Senha@abcd'],
    ['sem maiúscula', 'senha@2026'],
    ['sem símbolo', 'Senha12026'],
    ['espaço não vale como símbolo', 'Senha 2026'],
    ['letra acentuada no lugar do símbolo', 'Senhaã2026'],
    ['vazia', ''],
  ])('recusa senha %s', (_caso, senha) => {
    expect(newPasswordProblem(senha)).toBe(PASSWORD_RULE_MESSAGE)
  })

  // O servidor guarda só os primeiros 72 bytes; acento ocupa dois.
  it('aceita 72 bytes e recusa 73', () => {
    expect(newPasswordProblem('A1@' + 'a'.repeat(69))).toBeNull()
    expect(newPasswordProblem('A1@' + 'a'.repeat(70))).toBe(PASSWORD_LENGTH_MESSAGE)
    expect(newPasswordProblem('A1@' + 'ã'.repeat(35))).toBe(PASSWORD_LENGTH_MESSAGE)
  })
})
