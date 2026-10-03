import { evaluateWeatherAlerts } from './weather-alert-rules'
import { WEATHER_ALERT_PROFILE as P } from './weather-alert-profile'
import type { HazardHour } from './weather.types'

// Meio-dia UTC. Com deslocamento de -3 h (Brasília), 09:00 no local.
const NOW = new Date('2026-03-10T12:00:00.000Z')
const OFFSET = -3 * 3600

const hour = (offsetH: number, over: Partial<HazardHour> = {}): HazardHour => ({
  at: new Date(NOW.getTime() + offsetH * 3_600_000).toISOString(),
  precipitationMm: 0,
  precipitationProbabilityPct: 0,
  weatherCode: 1,
  uvIndex: 3,
  apparentTempC: 25,
  windGustsKmh: 10,
  isDay: true,
  ...over,
})

const calm = (n = 8) => Array.from({ length: n }, (_, i) => hour(i))
const withHour = (offsetH: number, over: Partial<HazardHour>) =>
  calm().map((h, i) => (i === offsetH ? hour(i, over) : h))

const kinds = (hours: HazardHour[]) => evaluateWeatherAlerts(hours, NOW, OFFSET).map((a) => a.kind)

describe('WEATHER_ALERT_PROFILE: escalas oficiais', () => {
  it('chuva pela escala do INMET: atenção a partir de 20 mm/h, perigo a partir de 30 mm/h', () => {
    expect(P.rainAttentionMmPerHour).toBe(20)
    expect(P.rainDangerMmPerHour).toBe(30)
  })

  it('rajada pela escala do INMET: perigo a partir de 60 km/h', () => {
    expect(P.gustDangerKmh).toBe(60)
  })

  it('índice UV pela escala da OMS: muito alto a partir de 8, extremo a partir de 11', () => {
    expect(P.uvAttention).toBe(8)
    expect(P.uvDanger).toBe(11)
  })

  it('calor pelo índice do NWS: cautela extrema a partir de 32,8 °C, perigo a partir de 39,4 °C', () => {
    expect(P.apparentTempAttentionC).toBe(32.8)
    expect(P.apparentTempDangerC).toBe(39.4)
  })
})

describe('evaluateWeatherAlerts', () => {
  it('tempo calmo não gera alerta', () => {
    expect(evaluateWeatherAlerts(calm(), NOW, OFFSET)).toEqual([])
  })

  describe('chuva intensa', () => {
    it('abre exatamente no limiar de atenção', () => {
      expect(kinds(withHour(1, { precipitationMm: P.rainAttentionMmPerHour, precipitationProbabilityPct: 90 }))).toEqual(['CHUVA_INTENSA'])
      expect(kinds(withHour(1, { precipitationMm: P.rainAttentionMmPerHour - 0.1, precipitationProbabilityPct: 90 }))).toEqual([])
    })

    it('probabilidade abaixo do mínimo não abre, e probabilidade ausente não bloqueia', () => {
      expect(kinds(withHour(1, { precipitationMm: 20, precipitationProbabilityPct: P.rainMinProbabilityPct - 1 }))).toEqual([])
      expect(kinds(withHour(1, { precipitationMm: 20, precipitationProbabilityPct: null }))).toEqual(['CHUVA_INTENSA'])
    })

    it('a partir do limiar de perigo a severidade sobe para perigo', () => {
      const [a] = evaluateWeatherAlerts(withHour(1, { precipitationMm: P.rainDangerMmPerHour, precipitationProbabilityPct: 90 }), NOW, OFFSET)
      expect(a.severity).toBe('PERIGO')
      const [b] = evaluateWeatherAlerts(withHour(1, { precipitationMm: P.rainDangerMmPerHour - 0.1, precipitationProbabilityPct: 90 }), NOW, OFFSET)
      expect(b.severity).toBe('ATENCAO')
    })

    it('horas seguidas viram uma janela só, com início, fim e pico', () => {
      const hours = calm().map((h, i) =>
        i >= 1 && i <= 3 ? hour(i, { precipitationMm: i === 2 ? 22.4 : 21, precipitationProbabilityPct: 80 }) : h,
      )
      const alerts = evaluateWeatherAlerts(hours, NOW, OFFSET)
      expect(alerts).toHaveLength(1)
      expect(alerts[0].startsAt).toBe('2026-03-10T13:00:00.000Z')
      expect(alerts[0].endsAt).toBe('2026-03-10T16:00:00.000Z')
      expect(alerts[0].event).toBe('Chuva intensa')
      // Horário no fuso do local (UTC-3) e o pico arredondado.
      expect(alerts[0].description).toBe('Chuva forte prevista entre 10:00 e 13:00, com até 22 mm por hora.')
      expect(alerts[0].id).toBe('wx:CHUVA_INTENSA:2026-03-10T13:00:00.000Z')
    })
  })

  describe('tempestade', () => {
    it.each(P.thunderstormCodes.map((c) => [c]))('código WMO %i abre tempestade', (code) => {
      expect(kinds(withHour(2, { weatherCode: code }))).toEqual(['TEMPESTADE'])
    })

    it('chuva sem trovoada (código 65) não é tempestade', () => {
      expect(kinds(withHour(2, { weatherCode: 65 }))).toEqual([])
    })

    it('granizo ou rajada forte sobem a severidade para perigo', () => {
      expect(evaluateWeatherAlerts(withHour(2, { weatherCode: 95 }), NOW, OFFSET)[0].severity).toBe('ATENCAO')
      expect(evaluateWeatherAlerts(withHour(2, { weatherCode: 96 }), NOW, OFFSET)[0].severity).toBe('PERIGO')
      expect(
        evaluateWeatherAlerts(withHour(2, { weatherCode: 95, windGustsKmh: P.gustDangerKmh }), NOW, OFFSET)[0].severity,
      ).toBe('PERIGO')
      expect(
        evaluateWeatherAlerts(withHour(2, { weatherCode: 95, windGustsKmh: P.gustDangerKmh - 0.1 }), NOW, OFFSET)[0].severity,
      ).toBe('ATENCAO')
    })

    it('rajada forte sem trovoada não abre tempestade', () => {
      expect(kinds(withHour(2, { windGustsKmh: P.gustDangerKmh + 20 }))).toEqual([])
    })
  })

  describe('sol intenso', () => {
    it('abre no limiar de índice UV muito alto, e extremo vira perigo', () => {
      expect(kinds(withHour(1, { uvIndex: P.uvAttention }))).toEqual(['SOL_INTENSO'])
      expect(kinds(withHour(1, { uvIndex: P.uvAttention - 0.1 }))).toEqual([])
      expect(evaluateWeatherAlerts(withHour(1, { uvIndex: P.uvAttention }), NOW, OFFSET)[0].severity).toBe('ATENCAO')
      expect(evaluateWeatherAlerts(withHour(1, { uvIndex: P.uvDanger }), NOW, OFFSET)[0].severity).toBe('PERIGO')
    })

    it('sensação térmica abre atenção mesmo com UV baixo, e no limiar de perigo vira perigo', () => {
      expect(kinds(withHour(1, { apparentTempC: P.apparentTempAttentionC }))).toEqual(['SOL_INTENSO'])
      expect(kinds(withHour(1, { apparentTempC: P.apparentTempAttentionC - 0.1 }))).toEqual([])
      expect(evaluateWeatherAlerts(withHour(1, { apparentTempC: P.apparentTempAttentionC }), NOW, OFFSET)[0].severity).toBe('ATENCAO')
      expect(evaluateWeatherAlerts(withHour(1, { apparentTempC: P.apparentTempDangerC - 0.1 }), NOW, OFFSET)[0].severity).toBe('ATENCAO')
      expect(evaluateWeatherAlerts(withHour(1, { apparentTempC: P.apparentTempDangerC }), NOW, OFFSET)[0].severity).toBe('PERIGO')
    })

    it('fora do período de sol não abre', () => {
      expect(kinds(withHour(1, { uvIndex: 12, apparentTempC: 45, isDay: false }))).toEqual([])
    })
  })

  describe('janela de avaliação', () => {
    it('a hora em curso conta, a hora já encerrada não', () => {
      const emCurso = [hour(-0.5, { weatherCode: 95 }), ...calm()]
      expect(kinds(emCurso)).toEqual(['TEMPESTADE'])
      const encerrada = [hour(-2, { weatherCode: 95 }), ...calm()]
      expect(kinds(encerrada)).toEqual([])
    })

    it('além do horizonte não gera alerta', () => {
      const longe = [...calm(), hour(P.horizonHours + 1, { weatherCode: 95 })]
      expect(kinds(longe)).toEqual([])
    })

    it('medição ausente não gera alerta nem derruba a avaliação', () => {
      const vazia = hour(1, {
        precipitationMm: null, precipitationProbabilityPct: null, weatherCode: null,
        uvIndex: null, apparentTempC: null, windGustsKmh: null, isDay: null,
      })
      expect(evaluateWeatherAlerts([vazia], NOW, OFFSET)).toEqual([])
    })

    it('tipos diferentes na mesma hora geram um alerta de cada', () => {
      expect(kinds(withHour(1, { weatherCode: 99, precipitationMm: 30, precipitationProbabilityPct: 95 }))).toEqual([
        'CHUVA_INTENSA',
        'TEMPESTADE',
      ])
    })
  })
})
