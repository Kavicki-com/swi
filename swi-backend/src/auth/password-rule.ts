import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator'

// Regra única da senha NOVA: cadastro, redefinição, troca e cadastro pelo
// painel. O login fica fora: quem tem senha antiga, mais fraca, continua
// entrando, e a regra só alcança essa pessoa quando ela trocar.
//
// É a regra que as telas anunciam ("8 caracteres incluindo letras e números, 1
// símbolo, 1 letra maiúscula") e que o app já aplica em
// mobile/lib/validatePassword.ts. Duas diferenças, as duas de propósito e as
// duas para o lado mais largo, de modo que tudo o que o app aprova passa aqui:
// minúscula não é exigida (o app não exige) e o símbolo é qualquer pontuação,
// não só os cinco que a tela lista como exemplo.
export const PASSWORD_MIN_LENGTH = 8

// O bcrypt lê só os primeiros 72 bytes e ignora o resto em silêncio: sem o
// teto, duas senhas iguais até ali seriam a mesma senha. Bytes e não
// caracteres, porque é em bytes que o corte acontece.
export const PASSWORD_MAX_BYTES = 72

export const PASSWORD_RULE_MESSAGE =
  'A senha precisa ter no mínimo 8 caracteres, com letras, números, 1 letra maiúscula e 1 símbolo'
export const PASSWORD_LENGTH_MESSAGE = 'A senha é longa demais (máximo de 72 caracteres)'

const HAS_NUMBER = /[0-9]/
const HAS_UPPERCASE = /[A-Z]/
// Pontuação ou símbolo, por classe Unicode. Letra acentuada é letra, espaço
// não conta, e caractere de controle também não.
const HAS_SYMBOL = /[\p{P}\p{S}]/u

/** O problema da senha nova, ou null quando ela cumpre a regra. */
export function newPasswordProblem(value: unknown): string | null {
  if (typeof value !== 'string') return PASSWORD_RULE_MESSAGE
  if (
    value.length < PASSWORD_MIN_LENGTH ||
    !HAS_NUMBER.test(value) ||
    !HAS_UPPERCASE.test(value) ||
    !HAS_SYMBOL.test(value)
  ) {
    return PASSWORD_RULE_MESSAGE
  }
  if (Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES) return PASSWORD_LENGTH_MESSAGE
  return null
}

export function IsNewPassword(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNewPassword',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          return newPasswordProblem(value) === null
        },
        defaultMessage(args: ValidationArguments) {
          return newPasswordProblem(args.value) ?? PASSWORD_RULE_MESSAGE
        },
      },
    })
  }
}
