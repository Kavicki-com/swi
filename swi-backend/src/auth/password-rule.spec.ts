import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ChangePasswordDto, ResetDto, SignupDto } from './dto'
import { CreateUserDto } from '../users/dto'
import { PASSWORD_LENGTH_MESSAGE, PASSWORD_RULE_MESSAGE, newPasswordProblem } from './password-rule'

describe('newPasswordProblem', () => {
  it('aceita a senha que cumpre a regra inteira', () => {
    expect(newPasswordProblem('Senha@2026')).toBeNull()
  })

  // O app não exige minúscula (mobile/lib/validatePassword.ts). Exigir aqui
  // faria o servidor recusar uma senha que a tela acabou de aprovar.
  it('aceita senha sem letra minúscula', () => {
    expect(newPasswordProblem('ABCDEF1@')).toBeNull()
  })

  // A lista do app (@#$%^) é exemplo, não cerca: gerador de senha usa outros.
  it.each(['Senha!2026', 'Senha&2026', 'Senha-2026', 'Senha_2026', 'Senha.2026'])(
    'aceita símbolo fora da lista do app: %s',
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
    ['caractere de controle no lugar do símbolo', 'Senha2026\u0000'],
    ['vazia', ''],
  ])('recusa senha %s', (_caso, senha) => {
    expect(newPasswordProblem(senha)).toBe(PASSWORD_RULE_MESSAGE)
  })

  it('recusa o que não é texto', () => {
    expect(newPasswordProblem(12345678)).toBe(PASSWORD_RULE_MESSAGE)
    expect(newPasswordProblem(undefined)).toBe(PASSWORD_RULE_MESSAGE)
    expect(newPasswordProblem(null)).toBe(PASSWORD_RULE_MESSAGE)
  })

  // O bcrypt ignora em silêncio o que passa de 72 bytes: duas senhas iguais
  // até ali seriam a mesma senha.
  it('aceita 72 bytes e recusa 73', () => {
    const base = 'A1@'
    expect(newPasswordProblem(base + 'a'.repeat(69))).toBeNull()
    expect(newPasswordProblem(base + 'a'.repeat(70))).toBe(PASSWORD_LENGTH_MESSAGE)
  })

  it('conta bytes, não caracteres: acento ocupa dois', () => {
    // 3 + 35 x 2 = 73 bytes em 38 caracteres.
    expect(newPasswordProblem('A1@' + 'ã'.repeat(35))).toBe(PASSWORD_LENGTH_MESSAGE)
  })
})

const errorsOf = async <T extends object>(cls: new () => T, body: Record<string, unknown>) =>
  validate(plainToInstance(cls, body), { whitelist: true })

const messagesOf = async <T extends object>(cls: new () => T, body: Record<string, unknown>) =>
  (await errorsOf(cls, body)).flatMap((e) => Object.values(e.constraints ?? {}))

// As quatro portas por onde uma senha NOVA entra. O login fica fora de
// propósito: quem tem senha antiga, mais fraca, continua entrando.
describe('regra da senha nova nas rotas', () => {
  const fraca = 'senha123'
  const forte = 'Senha@2026'

  it('cadastro pelo app', async () => {
    const base = { email: 'a@ex.com', name: 'A' }
    expect(await messagesOf(SignupDto, { ...base, password: fraca })).toEqual([PASSWORD_RULE_MESSAGE])
    expect(await errorsOf(SignupDto, { ...base, password: forte })).toHaveLength(0)
  })

  it('redefinição por código', async () => {
    const base = { email: 'a@ex.com', code: '123456' }
    expect(await messagesOf(ResetDto, { ...base, newPassword: fraca })).toEqual([PASSWORD_RULE_MESSAGE])
    expect(await errorsOf(ResetDto, { ...base, newPassword: forte })).toHaveLength(0)
  })

  it('troca autenticada: a regra vale para a nova, não para a atual', async () => {
    expect(await messagesOf(ChangePasswordDto, { currentPassword: forte, newPassword: fraca })).toEqual([
      PASSWORD_RULE_MESSAGE,
    ])
    expect(await errorsOf(ChangePasswordDto, { currentPassword: fraca, newPassword: forte })).toHaveLength(0)
  })

  it('cadastro pelo painel', async () => {
    const base = { email: 'a@ex.com', name: 'A', role: 'WORKER' }
    expect(await messagesOf(CreateUserDto, { ...base, password: fraca })).toEqual([PASSWORD_RULE_MESSAGE])
    expect(await errorsOf(CreateUserDto, { ...base, password: forte })).toHaveLength(0)
  })

  it('senha ausente é recusada', async () => {
    expect((await errorsOf(SignupDto, { email: 'a@ex.com', name: 'A' })).length).toBeGreaterThan(0)
  })
})
