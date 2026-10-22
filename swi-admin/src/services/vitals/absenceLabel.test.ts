import { absenceLabelOf, type AbsentMetric } from './absenceLabel'

describe('absenceLabelOf', () => {
  it.each<[AbsentMetric, string, string]>([
    ['heartRate', 'Aguardando leitura', 'Esta pulseira não envia batimento'],
    ['steps', 'Aguardando leitura', 'Esta pulseira não envia passos'],
    ['energy', 'Aguardando leitura', 'Esta pulseira não envia energia'],
    ['oxygen', 'Aguardando medição', 'Esta pulseira não envia oxigenação'],
    ['pressure', 'Aguardando medição', 'Esta pulseira não envia pressão'],
  ])('%s: "%s" e "%s"', (metric, awaiting, notSent) => {
    expect(absenceLabelOf(metric, { value: null, ausencia: 'AWAITING' })).toBe(awaiting)
    expect(absenceLabelOf(metric, { value: null, ausencia: 'NOT_SENT' })).toBe(notSent)
  })

  it('sem ausência (nula ou ausente) não há rótulo', () => {
    expect(absenceLabelOf('pressure', { value: null, ausencia: null })).toBeNull()
    expect(absenceLabelOf('pressure', { value: null })).toBeNull()
  })

  it('com valor não há rótulo, mesmo com o campo preenchido', () => {
    expect(absenceLabelOf('heartRate', { value: 72, ausencia: 'AWAITING' })).toBeNull()
  })
})
