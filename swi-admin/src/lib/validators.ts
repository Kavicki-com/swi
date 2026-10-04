const EMAIL_RE = /^[^\s@.]+(?:\.[^\s@.]+)*@[^\s@.]+(?:\.[^\s@.]+)+$/

export const isEmail = (value: string): boolean => EMAIL_RE.test(value)

export const minLength = (value: string, n: number): boolean => value.length >= n

export const requiredText = (value: string): boolean => value.trim().length > 0

export const matches = (a: string, b: string): boolean => a === b

// Regra da senha NOVA: redefinição, troca e cadastro de usuário. É o espelho
// de swi-backend/src/auth/password-rule.ts, com as mesmas mensagens, para a
// tela recusar o que o servidor recusaria em vez de mandar e receber um 400.
// O login fica fora: quem tem senha antiga continua entrando.
export const PASSWORD_MIN_LENGTH = 8
// O servidor guarda só os primeiros 72 bytes da senha (limite do bcrypt).
export const PASSWORD_MAX_BYTES = 72

export const PASSWORD_RULE_MESSAGE =
  'A senha precisa ter no mínimo 8 caracteres, com letras, números, 1 letra maiúscula e 1 símbolo'
export const PASSWORD_LENGTH_MESSAGE = 'A senha é longa demais (máximo de 72 caracteres)'

const HAS_NUMBER = /[0-9]/
const HAS_UPPERCASE = /[A-Z]/
// Pontuação ou símbolo, por classe Unicode. Letra acentuada é letra, e espaço
// não conta.
const HAS_SYMBOL = /[\p{P}\p{S}]/u

/** O problema da senha nova, ou null quando ela cumpre a regra. */
export const newPasswordProblem = (value: string): string | null => {
  if (
    value.length < PASSWORD_MIN_LENGTH ||
    !HAS_NUMBER.test(value) ||
    !HAS_UPPERCASE.test(value) ||
    !HAS_SYMBOL.test(value)
  ) {
    return PASSWORD_RULE_MESSAGE
  }
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) return PASSWORD_LENGTH_MESSAGE
  return null
}
