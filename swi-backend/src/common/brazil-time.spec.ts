import { BRT_OFFSET_MS, formatBrtDate } from './brazil-time'

// O deslocamento de Brasília é um fato do país, não da telemetria nem dos
// relatórios. Ele tinha dois donos: o domínio da telemetria exportava a
// constante e o serviço de relatórios repetia a mesma aritmética embutida para
// formatar data. No dia em que o horário de verão voltar, ou em que o cliente
// ganhar uma segunda praça, a data do relatório e a fronteira do dia monitorado
// passariam a discordar sem nada quebrar e sem ninguém perceber.

describe('BRT_OFFSET_MS', () => {
  it('é três horas negativas, o UTC-3 fixo que o Brasil adotou em 2019', () => {
    expect(BRT_OFFSET_MS).toBe(-3 * 60 * 60 * 1000)
  })
})

describe('formatBrtDate', () => {
  it('formata dia, mês e ano com dois dígitos no dia e no mês', () => {
    expect(formatBrtDate(new Date('2026-01-05T15:00:00.000Z'))).toBe('05/01/2026')
  })

  it('instante logo depois da meia-noite UTC ainda é o dia anterior em Brasília', () => {
    expect(formatBrtDate(new Date('2026-01-02T01:30:00.000Z'))).toBe('01/01/2026')
  })

  it('três horas UTC em ponto já é o dia novo em Brasília', () => {
    expect(formatBrtDate(new Date('2026-01-02T03:00:00.000Z'))).toBe('02/01/2026')
  })

  it('a virada do ano segue o mesmo deslocamento', () => {
    expect(formatBrtDate(new Date('2027-01-01T02:00:00.000Z'))).toBe('31/12/2026')
  })
})
