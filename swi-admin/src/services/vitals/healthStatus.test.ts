// describe/it/expect vêm dos globals do Vitest.
import { condition, metric, neverReported, reporting } from '@/test-utils/telemetryFixtures'
import { healthStatusFrom } from './healthStatus'

const STALE = metric(98, { quality: 'STALE', measuredAt: '2026-10-01T14:20:00.000Z' })

describe('healthStatusFrom', () => {
  it('leitura atual sem condição é bom', () => {
    expect(healthStatusFrom(reporting())).toBe('good')
  })

  it('condição urgente aberta é urgência', () => {
    const t = { ...reporting(), conditions: [condition('HEALTH'), condition('URGENT')] }
    expect(healthStatusFrom(t)).toBe('low')
  })

  it('condição de saúde sem urgência é risco', () => {
    expect(healthStatusFrom({ ...reporting(), conditions: [condition('HEALTH')] })).toBe('alert')
  })

  // Relógio descarregado não é pessoa em risco.
  it('condição só de aparelho não muda o estado', () => {
    expect(healthStatusFrom({ ...reporting(), conditions: [condition('DEVICE')] })).toBe('good')
  })

  // Sem leitura atual ninguém confirma que a pessoa está bem.
  it('sem leitura, leitura velha ou nenhuma telemetria é desconhecido', () => {
    expect(healthStatusFrom(null)).toBe('unknown')
    expect(healthStatusFrom(neverReported())).toBe('unknown')
    expect(healthStatusFrom(reporting({ heartRate: STALE }))).toBe('unknown')
  })

  it('urgência vale mesmo com a leitura velha', () => {
    const t = { ...reporting({ heartRate: STALE }), conditions: [condition('URGENT')] }
    expect(healthStatusFrom(t)).toBe('low')
  })
})
