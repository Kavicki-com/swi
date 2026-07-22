// Conversores puros do domínio Tarefas. describe/it/expect vêm dos globals do
// Vitest.
//
// Ficam num arquivo próprio (e não nos testes das telas) porque não precisam de
// DOM, provider nem router: é parsing de string e aritmética de data, onde o
// bug se esconde nos cantos que a UI nunca exercita — ano de 2 dígitos, 31/02,
// '   ', 99:99, aniversário hoje, virada de ano. O caminho feliz destes mesmos
// helpers já é coberto pelas telas; aqui é o resto.
import {
  calcAge,
  displayDateToCalendar,
  displayTimeToMinutes,
  isoToDisplayDate,
  minutesToDisplayTime,
} from './format'

describe('isoToDisplayDate', () => {
  it('recorta o ISO datetime pra dd/mm/aaaa', () => {
    expect(isoToDisplayDate('2026-07-21T00:00:00.000Z')).toBe('21/07/2026')
  })

  it('aceita data de calendário pura (sem a parte de hora)', () => {
    expect(isoToDisplayDate('2026-07-21')).toBe('21/07/2026')
  })

  it('devolve vazio pra null', () => {
    expect(isoToDisplayDate(null)).toBe('')
  })

  it('devolve vazio pra string vazia', () => {
    expect(isoToDisplayDate('')).toBe('')
  })

  it('devolve vazio pra ISO malformado em vez de propagar lixo pro campo', () => {
    expect(isoToDisplayDate('21/07/2026')).toBe('')
    expect(isoToDisplayDate('2026-7-21')).toBe('')
    expect(isoToDisplayDate('não é data')).toBe('')
  })

  // O off-by-one de fuso é o motivo de fatiar a string em vez de usar `Date`:
  // '2026-01-01T00:00:00.000Z' num fuso negativo viraria 31/12/2025.
  it('não desloca a data em fuso negativo (não passa por Date)', () => {
    expect(isoToDisplayDate('2026-01-01T00:00:00.000Z')).toBe('01/01/2026')
  })
})

describe('displayDateToCalendar', () => {
  it('converte dd/mm/aaaa em AAAA-MM-DD', () => {
    expect(displayDateToCalendar('05/03/2026')).toBe('2026-03-05')
  })

  it('ignora espaços em volta', () => {
    expect(displayDateToCalendar('  19/12/2026  ')).toBe('2026-12-19')
  })

  // null = campo vazio (a chave sai do payload) — diferente de inválido.
  it('devolve null pra vazio e pra só espaços', () => {
    expect(displayDateToCalendar('')).toBeNull()
    expect(displayDateToCalendar('   ')).toBeNull()
  })

  it('rejeita formato torto', () => {
    expect(displayDateToCalendar('1/1/2026')).toBeUndefined()
    expect(displayDateToCalendar('2026-03-05')).toBeUndefined()
    expect(displayDateToCalendar('05-03-2026')).toBeUndefined()
    expect(displayDateToCalendar('05/03/2026 10:00')).toBeUndefined()
    expect(displayDateToCalendar('aa/bb/cccc')).toBeUndefined()
  })

  it('rejeita ano de 2 dígitos', () => {
    expect(displayDateToCalendar('05/03/26')).toBeUndefined()
  })

  // O formato sozinho não basta: '31/02/2026' casa com a regex, vira
  // '2026-02-31' e só morre no backend com um 400 genérico.
  it('rejeita dia que não existe no mês', () => {
    expect(displayDateToCalendar('31/02/2026')).toBeUndefined()
    expect(displayDateToCalendar('31/04/2026')).toBeUndefined()
    expect(displayDateToCalendar('32/01/2026')).toBeUndefined()
  })

  it('rejeita mês fora de 1-12 e dia zero', () => {
    expect(displayDateToCalendar('13/25/2026')).toBeUndefined()
    expect(displayDateToCalendar('01/13/2026')).toBeUndefined()
    expect(displayDateToCalendar('00/00/0000')).toBeUndefined()
    expect(displayDateToCalendar('00/01/2026')).toBeUndefined()
  })

  it('aceita 29/02 em ano bissexto e recusa em ano comum', () => {
    expect(displayDateToCalendar('29/02/2024')).toBe('2024-02-29')
    expect(displayDateToCalendar('29/02/2026')).toBeUndefined()
  })

  it('aceita os extremos válidos do mês', () => {
    expect(displayDateToCalendar('31/01/2026')).toBe('2026-01-31')
    expect(displayDateToCalendar('30/04/2026')).toBe('2026-04-30')
    expect(displayDateToCalendar('28/02/2026')).toBe('2026-02-28')
  })
})

describe('data — ida e volta', () => {
  // O par é o que fecha a armadilha nº 1: o detalhe chega em ISO, aparece no
  // campo em dd/mm/aaaa e tem que voltar pro backend como data de calendário.
  it('ISO → campo → payload preserva o dia', () => {
    const iso = '2026-07-20T00:00:00.000Z'
    expect(displayDateToCalendar(isoToDisplayDate(iso))).toBe('2026-07-20')
  })

  it('vale pro fim do ano, onde um off-by-one trocaria o ano inteiro', () => {
    expect(displayDateToCalendar(isoToDisplayDate('2026-12-31T00:00:00.000Z'))).toBe('2026-12-31')
    expect(displayDateToCalendar(isoToDisplayDate('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01')
  })
})

describe('minutesToDisplayTime', () => {
  it('formata minutos em hh:mm', () => {
    expect(minutesToDisplayTime(150)).toBe('02:30')
    expect(minutesToDisplayTime(90)).toBe('01:30')
  })

  it('zera-pad hora e minuto', () => {
    expect(minutesToDisplayTime(5)).toBe('00:05')
    expect(minutesToDisplayTime(0)).toBe('00:00')
  })

  it('não estoura em duração maior que um dia', () => {
    expect(minutesToDisplayTime(1500)).toBe('25:00')
  })

  // null é o "não informado" do contrato (estimatedMinutes é nulável).
  it('devolve vazio pra null', () => {
    expect(minutesToDisplayTime(null)).toBe('')
  })
})

describe('displayTimeToMinutes', () => {
  it('converte hh:mm em minutos', () => {
    expect(displayTimeToMinutes('02:30')).toBe(150)
    expect(displayTimeToMinutes('00:45')).toBe(45)
  })

  it('aceita hora de 1 dígito e ignora espaços', () => {
    expect(displayTimeToMinutes('2:30')).toBe(150)
    expect(displayTimeToMinutes('  01:00  ')).toBe(60)
  })

  it('devolve null pra vazio e pra só espaços', () => {
    expect(displayTimeToMinutes('')).toBeNull()
    expect(displayTimeToMinutes('   ')).toBeNull()
  })

  it('rejeita minuto fora de 0-59', () => {
    expect(displayTimeToMinutes('99:99')).toBeUndefined()
    expect(displayTimeToMinutes('01:60')).toBeUndefined()
  })

  it('rejeita formato torto', () => {
    expect(displayTimeToMinutes('2h30')).toBeUndefined()
    expect(displayTimeToMinutes('130')).toBeUndefined()
    expect(displayTimeToMinutes('01:30:00')).toBeUndefined()
    expect(displayTimeToMinutes('aa:bb')).toBeUndefined()
  })

  it('aceita duração longa (o campo não é relógio, é estimativa)', () => {
    expect(displayTimeToMinutes('99:00')).toBe(5940)
  })
})

describe('tempo — ida e volta', () => {
  it('minutos → campo → minutos preserva o valor', () => {
    for (const minutes of [0, 5, 45, 90, 150, 1500]) {
      expect(displayTimeToMinutes(minutesToDisplayTime(minutes))).toBe(minutes)
    }
  })
})

// Testes diretos do cálculo, que a renderização não alcança: os casos que de
// fato quebram aritmética de data (aniversário hoje, 29/02, virada de ano).
//
// `today` é construído com o construtor NUMÉRICO (ano, mês, dia) de propósito:
// ele produz uma data-calendário LOCAL sem ambiguidade. `new Date('2027-02-28')`
// seria meia-noite UTC — em UTC-3 o `getDate()` local devolveria 27 e o teste
// mediria o fuso da máquina em vez do cálculo.
describe('calcAge', () => {
  it('conta o ano cheio quando o aniversário é exatamente hoje', () => {
    expect(calcAge('1994-07-21T00:00:00.000Z', new Date(2026, 6, 21))).toBe(32)
  })

  it('não adianta o aniversário de quem nasceu em 29/02 num ano comum', () => {
    // Em 2027 não existe 29/02; em 28/02 ainda não fez aniversário.
    expect(calcAge('1996-02-29T00:00:00.000Z', new Date(2027, 1, 28))).toBe(30)
  })

  it('conta o aniversário de 29/02 a partir de 1º/03 num ano comum', () => {
    expect(calcAge('1996-02-29T00:00:00.000Z', new Date(2027, 2, 1))).toBe(31)
  })

  it('não conta o ano na virada: nascido 31/12, avaliado em 1º/01', () => {
    expect(calcAge('1995-12-31T00:00:00.000Z', new Date(2026, 0, 1))).toBe(30)
  })

  it('devolve null sem birthDate', () => {
    expect(calcAge(null, new Date(2026, 6, 21))).toBeNull()
  })
})
