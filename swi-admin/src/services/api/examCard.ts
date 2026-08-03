// 'AAAA-MM-DD' → as partes que o ExamInfoCard do DS pede: ano separado do
// dia/mês abreviado ("2027" + "05 Mar"). Espelha mobile/services/api/examCard.ts.
//
// Fatia o texto em vez de usar Date: a validade é data de CALENDÁRIO, e
// `new Date('2027-03-05')` é meia-noite UTC — em UTC-3 os getters locais
// voltam pro dia 4, e o card mostraria a validade um dia antes da real.
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export type ExamCardParts = { year: string; date: string }

export function examCardParts(date: string): ExamCardParts {
  const [y, m, d] = date.split('-')
  return {
    year: y ?? '',
    date: `${d ?? ''} ${MESES[Number(m) - 1] ?? ''}`.trim(),
  }
}

/**
 * 'dd/mm/aaaa' digitado → data de calendário 'AAAA-MM-DD', ou null quando a
 * data não existe. O regex sozinho aceita 31/02 e 99/99: sem esta checagem o
 * backend receberia uma validade impossível e o card a exibiria como certa.
 */
export function toCalendarDate(typed: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(typed.trim())
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  // Round-trip em UTC: dia fora do mês vira Invalid Date ou escorrega de mês.
  const parsed = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10) === iso ? iso : null
}
