// src/pages/tasks/format.ts
// Conversores puros do domínio Tarefas — nenhum import de React, DS ou rede.
//
// Vivem fora das telas de propósito. Antes, `isoToDisplayDate` e companhia
// moravam no TaskForm e `calcAge` no ResponsiblePicker, o que fazia
// COMPONENTES DE PÁGINA virarem biblioteca uns dos outros: pra entender uma
// formatação de data era preciso abrir um arquivo cheio de Modal, ImageUploader
// e Combobox, nada disso conceitualmente relacionado. O reuso também era
// parcial — o detalhe importava do formulário só as duas funções da direção
// API→tela e nunca as da direção tela→API, sinal de que a fronteira estava
// desenhada em volta da tela errada.
//
// Consequência prática além da organização: hoje não há code-splitting, mas se
// as rotas ganharem `React.lazy`, importar um helper do TaskForm arrastaria a
// árvore inteira dele (Modal, uploader, picker) pro chunk do detalhe.
//
// Fica em pages/tasks/ (e não em src/lib/) porque o vocabulário é do domínio
// Tarefas: são as conversões exigidas pelo contrato de work orders. O src/lib/
// guarda utilitários genéricos de app (formatDateShort, formatRoute), que não
// conhecem DTO nenhum.
//
// As duas armadilhas do contrato que estas funções existem pra fechar:
//   • o backend devolve ISO datetime e ACEITA data de calendário ('AAAA-MM-DD');
//     devolver o que veio, direto, compila e falha em runtime com 400;
//   • ler qualquer uma das duas via `Date` desloca o dia em fuso negativo.

const CALENDAR_RE = /^\d{4}-\d{2}-\d{2}$/
const DISPLAY_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/
const DISPLAY_TIME_RE = /^(\d{1,3}):([0-5]\d)$/

/**
 * ISO datetime da resposta → dd/mm/aaaa pro campo.
 *
 * Fatia a string em vez de passar por `Date`: o backend materializa a data de
 * calendário como meia-noite UTC, então `new Date(iso).getDate()` lido em
 * fuso negativo devolveria o dia anterior. Recortar os 10 primeiros caracteres
 * é a única leitura que não tem fuso nenhum envolvido.
 */
export function isoToDisplayDate(iso: string | null): string {
  if (!iso) return ''
  const calendar = iso.slice(0, 10)
  if (!CALENDAR_RE.test(calendar)) return ''
  const [year, month, day] = calendar.split('-')
  if (!year || !month || !day) return ''
  return `${day}/${month}/${year}`
}

// Dias por mês, índice 1-12. Fevereiro entra como 28 e o bissexto corrige.
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * dd/mm/aaaa do campo → 'AAAA-MM-DD' pro payload. `null` = vazio (a chave sai
 * do payload), `undefined` = digitado mas inválido (vira erro de validação).
 *
 * O formato sozinho não basta: '31/02/2026' casa com a regex e viraria
 * '2026-02-31', uma data que não existe. O backend rejeitaria com um 400
 * genérico depois do round-trip — o resto do formulário valida no cliente
 * justamente pra evitar isso, então o calendário se valida aqui também.
 */
export function displayDateToCalendar(display: string): string | null | undefined {
  const trimmed = display.trim()
  if (!trimmed) return null
  const match = DISPLAY_DATE_RE.exec(trimmed)
  if (!match) return undefined
  const [, day, month, year] = match
  if (!day || !month || !year) return undefined

  const monthNumber = Number(month)
  const dayNumber = Number(day)
  const yearNumber = Number(year)
  // A própria tabela filtra o mês inválido: o índice 0 guarda 0 e qualquer
  // coisa acima de 12 cai no `?? 0`. Com maxDay 0, nenhum dia >= 1 passa —
  // por isso não há um `if` separado pra faixa do mês (seria inalcançável).
  const maxDay =
    monthNumber === 2 && isLeapYear(yearNumber) ? 29 : (DAYS_IN_MONTH[monthNumber] ?? 0)
  if (dayNumber < 1 || dayNumber > maxDay) return undefined

  return `${year}-${month}-${day}`
}

export function minutesToDisplayTime(minutes: number | null): string {
  if (minutes === null) return ''
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/** hh:mm → minutos. `null` = vazio; `undefined` = digitado mas inválido. */
export function displayTimeToMinutes(display: string): number | null | undefined {
  const trimmed = display.trim()
  if (!trimmed) return null
  const match = DISPLAY_TIME_RE.exec(trimmed)
  if (!match) return undefined
  const [, hours, minutes] = match
  if (!hours || !minutes) return undefined
  return Number(hours) * 60 + Number(minutes)
}

// birthDate é ISO datetime: o backend materializa uma data de CALENDÁRIO como
// meia-noite UTC. Ler as partes da data de NASCIMENTO em UTC (e não as locais)
// evita o off-by-one em fusos negativos — '1994-07-22T00:00:00.000Z' lido em
// UTC-3 viraria 21/07 e adiantaria o aniversário em um dia.
//
// A data de HOJE, por outro lado, é lida em LOCAL DE PROPÓSITO. NÃO "corrija"
// isto pra UTC. A assimetria é intencional: comparamos a data-calendário de
// nascimento com a data-calendário de quem está OLHANDO a tela. Consequência
// esperada: no mesmo instante, quem nasceu em 22/07 aparece com 32 anos pra um
// admin em Tóquio (lá já é dia 22, aniversário feito) e 31 pra um em São Paulo
// (lá ainda é 21). É assim que aniversário funciona, e qualquer
// variante "globalmente consistente" (fixar UTC, fixar o fuso do servidor)
// erraria a idade pra alguém, e erraria justamente pra quem está mais perto do
// dado. Ver os testes unitários de calcAge.
export function calcAge(birthDate: string | null, today: Date): number | null {
  if (!birthDate) return null
  const born = new Date(birthDate)
  if (Number.isNaN(born.getTime())) return null

  let age = today.getFullYear() - born.getUTCFullYear()
  const monthsToBirthday = today.getMonth() - born.getUTCMonth()
  // Aniversário ainda não chegou neste ano: desconta um.
  if (monthsToBirthday < 0 || (monthsToBirthday === 0 && today.getDate() < born.getUTCDate())) {
    age -= 1
  }
  return age
}
