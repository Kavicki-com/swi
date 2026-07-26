// Máscaras de digitação dos campos brasileiros (QA 2026-07-24: os inputs
// aceitavam qualquer coisa, então CPF/telefone entravam no banco em formatos
// diferentes a cada cadastro).
//
// Todas normalizam pelos DÍGITOS antes de formatar: passar um valor já
// mascarado devolve ele mesmo (idempotente), o que deixa seguro aplicar tanto
// no `onChangeText` quanto ao semear o form com o que veio do backend.

export const onlyDigits = (value: string): string => value.replace(/\D+/g, '')

// Aplica o template acumulando dígito a dígito: o separador só entra quando o
// próximo dígito existe, senão o cursor "pularia" pontuação sozinho.
function applyTemplate(digits: string, groups: ReadonlyArray<[number, string]>): string {
  let out = ''
  let i = 0
  for (const [size, separator] of groups) {
    if (i >= digits.length) break
    if (out) out += separator
    out += digits.slice(i, i + size)
    i += size
  }
  return out
}

export const maskCpf = (value: string): string =>
  applyTemplate(onlyDigits(value).slice(0, 11), [
    [3, ''],
    [3, '.'],
    [3, '.'],
    [2, '-'],
  ])

export const maskCnpj = (value: string): string =>
  applyTemplate(onlyDigits(value).slice(0, 14), [
    [2, ''],
    [3, '.'],
    [3, '.'],
    [4, '/'],
    [2, '-'],
  ])

export const maskDate = (value: string): string =>
  applyTemplate(onlyDigits(value).slice(0, 8), [
    [2, ''],
    [2, '/'],
    [4, '/'],
  ])

export const maskCep = (value: string): string =>
  applyTemplate(onlyDigits(value).slice(0, 8), [
    [5, ''],
    [3, '-'],
  ])

// Celular (11 dígitos) e fixo (10) têm quebras diferentes, então o template
// depende do tamanho — por isso não passa pelo applyTemplate genérico.
export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  const rest = d.slice(2)
  const split = d.length > 10 ? 5 : 4
  if (rest.length <= split) return `(${d.slice(0, 2)}) ${rest}`
  return `(${d.slice(0, 2)}) ${rest.slice(0, split)}-${rest.slice(split)}`
}
