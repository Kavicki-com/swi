// describe/it/expect vêm dos globals do Vitest.
import type { CalibrationHistoryItem } from '@/services/api/calibration'
import {
  actorLabelOf,
  changeValueLabel,
  cutFieldsOf,
  cutsFromDraft,
  draftOfCuts,
  formatDecimal,
  parseDecimal,
  safetyFromDraft,
  safetyValuesLabel,
} from './calibrationFields'

describe('parseDecimal e formatDecimal', () => {
  it('aceita vírgula e ponto como separador decimal', () => {
    expect(parseDecimal('36,5')).toBe(36.5)
    expect(parseDecimal(' 36.5 ')).toBe(36.5)
    expect(parseDecimal('120')).toBe(120)
  })

  it('vazio vira nulo e texto que não é número vira inválido', () => {
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('   ')).toBeNull()
    expect(parseDecimal('abc')).toBe('invalid')
    expect(parseDecimal('1,2,3')).toBe('invalid')
  })

  it('escreve com vírgula e sem ponto de milhar; nulo fica vazio', () => {
    expect(formatDecimal(36.5)).toBe('36,5')
    expect(formatDecimal(11000)).toBe('11000')
    expect(formatDecimal(null)).toBe('')
  })
})

describe('cutFieldsOf', () => {
  it('cada família tem os rótulos dela', () => {
    expect(cutFieldsOf('HEART_RATE').map((f) => f.label)).toEqual([
      'Excelência até (bpm)',
      'Fadiga a partir de (bpm)',
    ])
    expect(cutFieldsOf('OXYGEN_SATURATION').map((f) => f.label)).toEqual([
      'Excelência a partir de (%)',
      'Fadiga abaixo de (%)',
    ])
    expect(cutFieldsOf('BODY_TEMPERATURE').map((f) => f.key)).toEqual(['p10', 'p25', 'p75', 'p90'])
    expect(cutFieldsOf('STEPS').map((f) => f.label)).toEqual([
      'Habitual a partir de (passos)',
      'Habitual até (passos)',
    ])
  })
})

describe('cutsFromDraft', () => {
  it('manda todas as chaves, com vazio como nulo', () => {
    expect(cutsFromDraft('HEART_RATE', { excellence: '118', fatigue: '' })).toEqual({
      cuts: { excellence: 118, fatigue: null },
    })
  })

  it('número inválido marca o campo', () => {
    const result = cutsFromDraft('HEART_RATE', { excellence: 'x', fatigue: '150' })
    expect(result).toEqual({ errors: { excellence: expect.stringContaining('número') } })
  })

  it('confere a ordem: excelência abaixo da fadiga quando maior é pior', () => {
    expect(cutsFromDraft('HEART_RATE', { excellence: '150', fatigue: '150' })).toEqual({
      errors: { fatigue: 'O corte de excelência deve ficar abaixo do de fadiga.' },
    })
  })

  it('na oxigenação a fadiga fica abaixo da excelência', () => {
    expect(cutsFromDraft('OXYGEN_SATURATION', { excellence: '94', fatigue: '95' })).toEqual({
      errors: { fatigue: 'O corte de fadiga deve ficar abaixo do de excelência.' },
    })
    expect(cutsFromDraft('OXYGEN_SATURATION', { excellence: '96', fatigue: '93' })).toEqual({
      cuts: { excellence: 96, fatigue: 93 },
    })
  })

  it('temperatura: p25 igual a p75 deixa a faixa normal vazia', () => {
    const draft = { p10: '35,8', p25: '36,5', p75: '36,5', p90: '37,4' }
    expect(cutsFromDraft('BODY_TEMPERATURE', draft)).toEqual({
      errors: { p75: expect.stringContaining('p25') },
    })
    // p10 igual a p25 pode: só a faixa normal não fica vazia.
    expect(cutsFromDraft('BODY_TEMPERATURE', { ...draft, p10: '36,5', p75: '37' })).toEqual({
      cuts: { p10: 36.5, p25: 36.5, p75: 37, p90: 37.4 },
    })
  })

  it('atividade: o começo do habitual fica abaixo do fim', () => {
    expect(cutsFromDraft('STEPS', { below: '11000', above: '8000' })).toEqual({
      errors: { above: expect.any(String) },
    })
  })

  it('distância: o campo fala em km e o corte vai em metros', () => {
    expect(cutFieldsOf('DISTANCE').map((f) => f.label)).toEqual([
      'Habitual a partir de (km)',
      'Habitual até (km)',
    ])
    expect(draftOfCuts('DISTANCE', { below: 5200, above: 8250 })).toEqual({
      below: '5,2',
      above: '8,25',
    })
    expect(draftOfCuts('DISTANCE', { below: 5234, above: null })).toEqual({
      below: '5,234',
      above: '',
    })
    expect(cutsFromDraft('DISTANCE', { below: '5,2', above: '8.25' })).toEqual({
      cuts: { below: 5200, above: 8250 },
    })
    // Sem ruído de ponto flutuante: 1,1 km são 1100 m cravados.
    expect(cutsFromDraft('DISTANCE', { below: '1,1', above: '' })).toEqual({
      cuts: { below: 1100, above: null },
    })
    expect(cutsFromDraft('DISTANCE', { below: '8', above: '5' })).toEqual({
      errors: { above: expect.any(String) },
    })
  })

  it('draftOfCuts escreve os cortes atuais com vírgula', () => {
    expect(draftOfCuts('BODY_TEMPERATURE', { p10: 35.8, p25: null, p75: 37, p90: 37.4 })).toEqual({
      p10: '35,8',
      p25: '',
      p75: '37',
      p90: '37,4',
    })
  })
})

describe('travas', () => {
  it('safetyFromDraft exige todos os valores', () => {
    expect(safetyFromDraft('OXYGEN_LOW', { openAt: '90', closeAt: '' })).toEqual({
      errors: { closeAt: expect.any(String) },
    })
    expect(safetyFromDraft('OXYGEN_LOW', { openAt: '89,5', closeAt: '92' })).toEqual({
      values: { openAt: 89.5, closeAt: 92 },
    })
  })

  it('safetyValuesLabel lê o JSON com desconfiança', () => {
    expect(safetyValuesLabel('OXYGEN_LOW', { openAt: 90, closeAt: 92 })).toBe(
      'abre em 90%, fecha em 92%',
    )
    expect(
      safetyValuesLabel('BLOOD_PRESSURE_HIGH', {
        systolicAt: 160,
        diastolicAt: 100,
        systolicRecoverBelow: 150,
        diastolicRecoverBelow: 95,
      }),
    ).toBe('abre com 160/100 mmHg, fecha abaixo de 150/95 mmHg')
    expect(safetyValuesLabel('OXYGEN_LOW', { openAt: '90' })).toBeNull()
    expect(safetyValuesLabel('OXYGEN_LOW', null)).toBeNull()
  })
})

describe('histórico', () => {
  const item = (over: Partial<CalibrationHistoryItem>): CalibrationHistoryItem => ({
    id: 'h1',
    action: 'BAND_OVERRIDE',
    metric: 'HEART_RATE',
    rule: null,
    from: null,
    to: null,
    actor: { id: 'u1', name: 'Ana' },
    at: '2026-10-21T12:00:00.000Z',
    ...over,
  })

  it('faixa: nulo é o aprendido e cortes viram frase', () => {
    const h = item({ from: null, to: { excellence: 110, fatigue: 140 } })
    expect(changeValueLabel(h, 'from')).toBe('aprendido')
    expect(changeValueLabel(h, 'to')).toBe('excelência até 110, fadiga a partir de 140')
  })

  it('trava: nulo é o padrão', () => {
    const h = item({
      action: 'SAFETY_REVERT',
      metric: null,
      rule: 'OXYGEN_LOW',
      from: { openAt: 89, closeAt: 91 },
    })
    expect(changeValueLabel(h, 'from')).toBe('abre em 89%, fecha em 91%')
    expect(changeValueLabel(h, 'to')).toBe('padrão')
  })

  it('troca de aparelho mostra relógio ou pulseira', () => {
    const h = item({
      action: 'RECALIBRATE_DEVICE',
      metric: null,
      from: { deviceFamily: 'WATCH' },
      to: { deviceFamily: 'BAND' },
      actor: null,
    })
    expect(changeValueLabel(h, 'from')).toBe('Relógio')
    expect(changeValueLabel(h, 'to')).toBe('Pulseira')
    expect(actorLabelOf(h)).toBe('Sistema')
  })

  it('JSON torto não quebra a lista', () => {
    expect(changeValueLabel(item({ to: 'lixo' }), 'to')).toBe('valor ilegível')
    expect(changeValueLabel(item({ to: [1, 2] }), 'to')).toBe('valor ilegível')
    expect(actorLabelOf(item({ actor: { id: 'u9', name: '' } }))).toBe('Pessoa removida')
  })
})
