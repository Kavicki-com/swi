// describe/it/expect vêm dos globals do Vitest.
import { metric, reporting } from '@/test-utils/telemetryFixtures'
import { myVitalsFrom } from './useMyVitals'

describe('myVitalsFrom', () => {
  // Admin não pareia aparelho: o widget do cabeçalho mostra a ausência em vez
  // de um batimento que ninguém mediu.
  it('sem aparelho pareado, tudo é ausência', () => {
    expect(myVitalsFrom('none', null)).toEqual({ bpm: null, pressure: null, progress: null })
    expect(myVitalsFrom('loading', null)).toEqual({ bpm: null, pressure: null, progress: null })
  })

  it('aparelho pareado sem leitura ainda é ausência', () => {
    expect(myVitalsFrom('paired', null)).toEqual({ bpm: null, pressure: null, progress: null })
  })

  it('aparelho pareado com leitura mostra batimento, pressão e desgaste', () => {
    const telemetry = reporting({
      bloodPressure: metric({ systolic: 128, diastolic: 82 }, { source: 'EXTERNAL_CUFF' }),
    })
    expect(myVitalsFrom('paired', telemetry)).toEqual({ bpm: 112, pressure: '128/82', progress: 38.4 })
  })

  // Leitura que sobrou de antes de o aparelho sair não vale para quem não tem aparelho.
  it('leitura sem aparelho pareado é ignorada', () => {
    expect(myVitalsFrom('none', reporting())).toEqual({ bpm: null, pressure: null, progress: null })
  })
})
