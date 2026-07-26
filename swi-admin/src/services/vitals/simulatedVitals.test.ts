// vitest globals (describe/it/expect) via globals: true — importar de 'vitest'
// duplicaria a instância e quebraria o registro do suite (ver weather.test.ts).
import { simulatedVitalsFor, SIMULATED_DATA_LABEL, type SimulatedVitals } from './simulatedVitals'

const T0 = Date.parse('2026-07-25T12:00:00.000Z')

const IDS = Array.from({ length: 40 }, (_, i) => `worker-${i}-${'abc'[i % 3]}`)

describe('simulatedVitalsFor', () => {
  it('é determinístico: mesmo worker + mesma janela → mesmos vitais', () => {
    expect(simulatedVitalsFor('w1', T0)).toEqual(simulatedVitalsFor('w1', T0))
    // Dentro da MESMA janela de 5 min o valor não muda (sem flicker na UI).
    expect(simulatedVitalsFor('w1', T0 + 60_000)).toEqual(simulatedVitalsFor('w1', T0))
  })

  it('workers diferentes ganham vitais diferentes (sem O+ universal da vida)', () => {
    const distinct = new Set(IDS.map((id) => simulatedVitalsFor(id, T0).bpm))
    expect(distinct.size).toBeGreaterThan(5)
  })

  it('valores SEMPRE plausíveis: bpm nunca 0, pressão realista, percentuais 0-100', () => {
    for (const id of IDS) {
      const v = simulatedVitalsFor(id, T0)
      expect(v.bpm).toBeGreaterThanOrEqual(55)
      expect(v.bpm).toBeLessThanOrEqual(145)
      expect(v.pressure).toMatch(/^\d{2}\/\d{1,2}$/)
      expect(v.fatiguePct).toBeGreaterThanOrEqual(0)
      expect(v.fatiguePct).toBeLessThanOrEqual(100)
      expect(v.effortPct).toBeGreaterThanOrEqual(0)
      expect(v.effortPct).toBeLessThanOrEqual(100)
      expect(v.fatigueMinutes).toBeGreaterThan(0)
    }
  })

  it('tier coerente com os vitais (fadiga = bpm alto; excelente = baseline) e label honesto', () => {
    for (const id of IDS) {
      const v: SimulatedVitals = simulatedVitalsFor(id, T0)
      if (v.tier === 'alerta-fadiga') {
        expect(v.bpm).toBeGreaterThanOrEqual(115)
        expect(v.statusLabel).toBe('Alerta de fadiga')
      } else if (v.tier === 'desgastado') {
        expect(v.statusLabel).toBe('Desgaste moderado')
      } else {
        expect(v.bpm).toBeLessThanOrEqual(96)
        expect(v.statusLabel).toBe('Condições excelentes')
      }
    }
  })

  it('população cobre os 3 tiers (a demo nunca mostra todo mundo idêntico)', () => {
    const tiers = new Set(IDS.map((id) => simulatedVitalsFor(id, T0).tier))
    expect(tiers).toEqual(new Set(['excelente', 'desgastado', 'alerta-fadiga']))
  })

  it('janelas de tempo diferentes variam os vitais do mesmo worker (parece vivo)', () => {
    const a = simulatedVitalsFor('w1', T0)
    const b = simulatedVitalsFor('w1', T0 + 30 * 60_000)
    expect(a).not.toEqual(b)
  })

  it('expõe o rótulo do selo', () => {
    expect(SIMULATED_DATA_LABEL).toBe('Dados simulados')
  })
})
