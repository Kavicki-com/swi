import {
  assertOriginCompatible,
  bloodPressureRecency,
  bloodPressureState,
  classifyEventAge,
  EVENT_AGE,
  FRESHNESS,
  isBacklog,
  METRICS,
  metricState,
  monitoredDayRange,
  qualityAt,
  assertEventTimeUsable,
  assertMeasuresSomething,
  rejectWorkerIdAuthority,
  validateMeasurement,
  validateRawMeasurement,
} from './metric-state'
import {
  InvalidMeasurementError,
  InvalidTelemetryEventError,
  TelemetryOriginMismatchError,
} from './telemetry.errors'

// Domínio puro do piloto Apple Watch. Todos os limites de atualidade moram
// aqui: nenhuma tela, projeção ou agregado recalcula os próprios prazos.
// "now" entra por parâmetro para os testes serem determinísticos.

const NOW = new Date('2026-09-02T12:00:00.000Z')
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString()
const hoursAgo = (h: number) => secondsAgo(h * 3600)

describe('qualityAt: BPM, passos, MPM, energia, esforço e desgaste', () => {
  it.each([
    'heartRate',
    'steps',
    'movementPerMinute',
    'activeEnergy',
    'energyRatePerHour',
    'effort',
    'wear',
  ] as const)('%s é atual até 45 s, desatualizado até 120 s e indisponível depois', (kind) => {
    expect(qualityAt(kind, secondsAgo(0), NOW)).toBe('CURRENT')
    expect(qualityAt(kind, secondsAgo(45), NOW)).toBe('CURRENT')
    expect(qualityAt(kind, secondsAgo(46), NOW)).toBe('STALE')
    expect(qualityAt(kind, secondsAgo(120), NOW)).toBe('STALE')
    expect(qualityAt(kind, secondsAgo(121), NOW)).toBe('UNAVAILABLE')
  })

  it('bateria é atual até 5 min, desatualizada até 30 min e indisponível depois', () => {
    expect(qualityAt('battery', secondsAgo(5 * 60), NOW)).toBe('CURRENT')
    expect(qualityAt('battery', secondsAgo(5 * 60 + 1), NOW)).toBe('STALE')
    expect(qualityAt('battery', secondsAgo(30 * 60), NOW)).toBe('STALE')
    expect(qualityAt('battery', secondsAgo(30 * 60 + 1), NOW)).toBe('UNAVAILABLE')
  })

  it('sem horário de medição é indisponível', () => {
    expect(qualityAt('heartRate', null, NOW)).toBe('UNAVAILABLE')
  })

  it('horário no futuro não vira "mais atual que o atual"', () => {
    expect(qualityAt('heartRate', secondsAgo(-30), NOW)).toBe('CURRENT')
  })

  it('os limites são únicos e vivem no domínio', () => {
    expect(FRESHNESS.VITAL).toEqual({ currentMs: 45_000, staleMs: 120_000 })
    expect(FRESHNESS.BATTERY).toEqual({ currentMs: 5 * 60_000, staleMs: 30 * 60_000 })
    expect(FRESHNESS.BLOOD_PRESSURE).toEqual({
      currentMs: 24 * 3_600_000,
      staleMs: 72 * 3_600_000,
    })
  })
})

describe('metricState: ausência preservada como null', () => {
  it('sem amostra devolve value null, quality UNAVAILABLE e a unidade canônica', () => {
    expect(metricState('heartRate', null, NOW)).toEqual({
      value: null,
      quality: 'UNAVAILABLE',
      measuredAt: null,
      source: null,
      unit: 'bpm',
    })
  })

  it('amostra atual devolve valor, horário e origem', () => {
    const at = secondsAgo(10)
    expect(
      metricState('heartRate', { value: 72, measuredAt: at, source: 'APPLE_WATCH' }, NOW),
    ).toEqual({
      value: 72,
      quality: 'CURRENT',
      measuredAt: at,
      source: 'APPLE_WATCH',
      unit: 'bpm',
    })
  })

  it('leitura antiga de sinal vital permanece visível com horário e qualidade indisponível', () => {
    const at = secondsAgo(600)
    const state = metricState('steps', { value: 4200, measuredAt: at, source: 'APPLE_WATCH' }, NOW)
    expect(state.quality).toBe('UNAVAILABLE')
    expect(state.value).toBe(4200)
    expect(state.measuredAt).toBe(at)
  })

  it('zero nunca representa ausência: value 0 real continua 0 e ausência continua null', () => {
    const zero = metricState('steps', { value: 0, measuredAt: secondsAgo(1), source: 'APPLE_WATCH' }, NOW)
    expect(zero.value).toBe(0)
    expect(metricState('steps', null, NOW).value).toBeNull()
  })
})

describe('pressão arterial: atual, histórica e sem medição recente', () => {
  const bp = { systolic: 130, diastolic: 80 }

  it('até 24 h é atual', () => {
    expect(bloodPressureRecency(hoursAgo(24), NOW)).toBe('CURRENT')
    expect(
      bloodPressureState({ value: bp, measuredAt: hoursAgo(1), source: 'EXTERNAL_CUFF' }, NOW),
    ).toMatchObject({ value: bp, quality: 'CURRENT', unit: 'mmHg', source: 'EXTERNAL_CUFF' })
  })

  it('entre 24 e 72 h é histórica: valor visível, qualidade STALE', () => {
    expect(bloodPressureRecency(hoursAgo(25), NOW)).toBe('HISTORICAL')
    expect(bloodPressureRecency(hoursAgo(72), NOW)).toBe('HISTORICAL')
    const state = bloodPressureState(
      { value: bp, measuredAt: hoursAgo(48), source: 'MANUAL_SWI' },
      NOW,
    )
    expect(state.quality).toBe('STALE')
    expect(state.value).toEqual(bp)
  })

  it('acima de 72 h é sem medição recente: value null, nunca 0/0', () => {
    expect(bloodPressureRecency(hoursAgo(73), NOW)).toBe('NONE')
    const state = bloodPressureState(
      { value: bp, measuredAt: hoursAgo(73), source: 'EXTERNAL_CUFF' },
      NOW,
    )
    expect(state).toEqual({
      value: null,
      quality: 'UNAVAILABLE',
      measuredAt: null,
      source: null,
      unit: 'mmHg',
    })
  })

  it('sem medição alguma também é NONE e null', () => {
    expect(bloodPressureRecency(null, NOW)).toBe('NONE')
    expect(bloodPressureState(null, NOW).value).toBeNull()
  })
})

describe('idade do evento: ao vivo, backlog e histórico', () => {
  it('evento dentro da janela atual é LIVE', () => {
    expect(classifyEventAge(secondsAgo(30), NOW)).toBe('LIVE')
    expect(classifyEventAge(secondsAgo(EVENT_AGE.liveMs / 1000), NOW)).toBe('LIVE')
  })

  it('evento com eventTime anterior ao limite atual é backlog e não promove snapshot', () => {
    expect(classifyEventAge(secondsAgo(121), NOW)).toBe('BACKLOG')
    expect(isBacklog(secondsAgo(121), NOW)).toBe(true)
    expect(isBacklog(secondsAgo(10), NOW)).toBe(false)
  })

  it('evento com mais de 48 h é histórico', () => {
    expect(classifyEventAge(hoursAgo(48), NOW)).toBe('BACKLOG')
    expect(classifyEventAge(hoursAgo(48.01), NOW)).toBe('HISTORICAL')
    expect(isBacklog(hoursAgo(49), NOW)).toBe(true)
  })
})

describe('dia monitorado: o dia civil em Brasília, não as últimas 24 horas', () => {
  it('12:00Z é 09:00 em Brasília: o dia começou às 03:00Z e termina às 03:00Z seguintes', () => {
    const { start, end } = monitoredDayRange(NOW)

    expect(start.toISOString()).toBe('2026-09-02T03:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-03T03:00:00.000Z')
  })

  it('a fronteira é a meia-noite de Brasília: 02:59:59.999Z ainda é a véspera, 03:00Z já é o dia novo', () => {
    const beforeMidnight = monitoredDayRange(new Date('2026-09-02T02:59:59.999Z'))
    const atMidnight = monitoredDayRange(new Date('2026-09-02T03:00:00.000Z'))

    expect(beforeMidnight.start.toISOString()).toBe('2026-09-01T03:00:00.000Z')
    expect(beforeMidnight.end.toISOString()).toBe('2026-09-02T03:00:00.000Z')
    expect(atMidnight.start.toISOString()).toBe('2026-09-02T03:00:00.000Z')
    expect(atMidnight.end.toISOString()).toBe('2026-09-03T03:00:00.000Z')
    // Os dias se encostam sem lacuna nem sobreposição: o fim de um é o início
    // do seguinte, e quem consulta usa o fim como limite exclusivo.
    expect(beforeMidnight.end).toEqual(atMidnight.start)
  })
})

describe('origem REAL e DEMO nunca se misturam', () => {
  it('mesma origem passa', () => {
    expect(() => assertOriginCompatible('REAL', 'REAL')).not.toThrow()
    expect(() => assertOriginCompatible('DEMO', 'DEMO')).not.toThrow()
  })

  it('sessão REAL rejeita evento DEMO e vice-versa, com erro específico', () => {
    expect(() => assertOriginCompatible('REAL', 'DEMO')).toThrow(TelemetryOriginMismatchError)
    expect(() => assertOriginCompatible('DEMO', 'REAL')).toThrow(TelemetryOriginMismatchError)
  })
})

describe('Q13, Q14 e Q16 com unidades explícitas', () => {
  const watch = 'APPLE_WATCH' as const

  it('kcal/h, passos inteiros e movimentos por minuto', () => {
    expect(METRICS.energyRatePerHour).toMatchObject({
      indicator: 'Q13',
      unit: 'kcal/h',
      sources: ['DERIVED'],
    })
    expect(METRICS.steps).toMatchObject({ indicator: 'Q14', unit: 'steps', sources: ['APPLE_WATCH'] })
    expect(METRICS.movementPerMinute).toMatchObject({
      indicator: 'Q16',
      unit: 'mpm',
      sources: ['DERIVED'],
    })
    expect(METRICS.heartRate.unit).toBe('bpm')
    expect(METRICS.activeEnergy.unit).toBe('kcal')
    expect(METRICS.battery.unit).toBe('%')
    expect(METRICS.bloodPressure.unit).toBe('mmHg')
  })

  it('unidade errada é rejeitada', () => {
    expect(() => validateMeasurement('steps', { value: 10, unit: 'km', source: watch })).toThrow(
      InvalidMeasurementError,
    )
  })

  it('NaN, infinito e negativo são rejeitados', () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, -1]
    for (const value of bad) {
      expect(() => validateMeasurement('activeEnergy', { value, unit: 'kcal', source: watch })).toThrow(
        InvalidMeasurementError,
      )
    }
  })

  it('passos precisam ser inteiros', () => {
    expect(() => validateMeasurement('steps', { value: 12.5, unit: 'steps', source: watch })).toThrow(
      InvalidMeasurementError,
    )
    expect(() => validateMeasurement('steps', { value: 12, unit: 'steps', source: watch })).not.toThrow()
  })

  it('BPM fora da faixa fisiológica é impossível', () => {
    expect(() => validateMeasurement('heartRate', { value: 0, unit: 'bpm', source: watch })).toThrow(
      InvalidMeasurementError,
    )
    expect(() => validateMeasurement('heartRate', { value: 400, unit: 'bpm', source: watch })).toThrow(
      InvalidMeasurementError,
    )
  })

  it('bateria é percentual entre 0 e 100', () => {
    expect(() => validateMeasurement('battery', { value: 101, unit: '%', source: watch })).toThrow(
      InvalidMeasurementError,
    )
    expect(() => validateMeasurement('battery', { value: 0, unit: '%', source: watch })).not.toThrow()
  })

  it('a origem tem de ser permitida para a métrica', () => {
    expect(() =>
      validateMeasurement('heartRate', { value: 70, unit: 'bpm', source: 'MANUAL_SWI' }),
    ).toThrow(InvalidMeasurementError)
    expect(() =>
      validateMeasurement('bloodPressure', {
        value: { systolic: 120, diastolic: 80 },
        unit: 'mmHg',
        source: watch,
      }),
    ).toThrow(InvalidMeasurementError)
  })

  it('pressão só aceita par sistólica/diastólica plausível em mmHg', () => {
    const ok = {
      value: { systolic: 130, diastolic: 80 },
      unit: 'mmHg',
      source: 'EXTERNAL_CUFF',
    } as const
    expect(() => validateMeasurement('bloodPressure', ok)).not.toThrow()
    const rejected = [
      { systolic: 13, diastolic: 8 },
      { systolic: 80, diastolic: 130 },
      { systolic: 0, diastolic: 0 },
      { systolic: 120.5, diastolic: 80 },
    ]
    for (const value of rejected) {
      expect(() => validateMeasurement('bloodPressure', { ...ok, value })).toThrow(
        InvalidMeasurementError,
      )
    }
  })
})

describe('evento bruto: workerId não é autoridade', () => {
  it('payload com workerId é rejeitado antes de qualquer uso', () => {
    expect(() => rejectWorkerIdAuthority({ eventId: 'e1', workerId: 'w1' })).toThrow(
      InvalidTelemetryEventError,
    )
  })

  it('payload sem workerId passa; journeyId e taskId são contexto opcional', () => {
    expect(() =>
      rejectWorkerIdAuthority({ eventId: 'e1', journeyId: 'j1', taskId: null }),
    ).not.toThrow()
  })
})

// Medições brutas do evento. Cinco delas são a mesma coisa que uma métrica
// canônica e herdam a faixa dela; motionCount não, porque MPM é derivada e a
// contagem crua não é apresentável (decisão congelada sobre Q16).
describe('validateRawMeasurement', () => {
  const bpm = { value: 82, unit: 'bpm', source: 'APPLE_WATCH' as const }

  it('aceita as medições que o evento declara carregar', () => {
    expect(() => validateRawMeasurement('heartRate', bpm)).not.toThrow()
    expect(() =>
      validateRawMeasurement('stepDelta', { value: 12, unit: 'steps', source: 'APPLE_WATCH' }),
    ).not.toThrow()
    expect(() =>
      validateRawMeasurement('motionCount', { value: 40, unit: 'count', source: 'APPLE_WATCH' }),
    ).not.toThrow()
  })

  // Sem esta recusa a chave desconhecida seria apagada em silêncio pelo
  // normalizador, e o aparelho seguiria mandando o que nunca é gravado.
  it('recusa chave de medição que o contrato não declara', () => {
    expect(() => validateRawMeasurement('humidity', bpm)).toThrow(InvalidTelemetryEventError)
  })

  it('recusa medição sem forma de medição', () => {
    expect(() => validateRawMeasurement('heartRate', 82)).toThrow(InvalidMeasurementError)
    expect(() => validateRawMeasurement('heartRate', { value: 82 })).toThrow(InvalidMeasurementError)
  })

  it('valida motionCount pela própria unidade e origem', () => {
    expect(() =>
      validateRawMeasurement('motionCount', { value: 40, unit: 'mpm', source: 'APPLE_WATCH' }),
    ).toThrow(InvalidMeasurementError)
    expect(() =>
      validateRawMeasurement('motionCount', { value: 40, unit: 'count', source: 'MANUAL_SWI' }),
    ).toThrow(InvalidMeasurementError)
    expect(() =>
      validateRawMeasurement('motionCount', { value: -1, unit: 'count', source: 'APPLE_WATCH' }),
    ).toThrow(InvalidMeasurementError)
  })
})

// Horário no futuro não é curiosidade: o snapshot só é promovido por evento
// mais recente que o já promovido, então um evento adiantado congelaria o
// estado atual do funcionário até o relógio do servidor alcançá-lo.
describe('assertEventTimeUsable', () => {
  const now = new Date('2026-09-03T12:00:00.000Z')

  it('aceita medição no passado e a pequena folga de relógio do aparelho', () => {
    expect(() => assertEventTimeUsable('2026-09-03T11:59:00.000Z', now)).not.toThrow()
    expect(() => assertEventTimeUsable('2026-09-03T12:01:00.000Z', now)).not.toThrow()
  })

  it('recusa medição muito adiantada', () => {
    expect(() => assertEventTimeUsable('2026-09-03T12:30:00.000Z', now)).toThrow(
      InvalidTelemetryEventError,
    )
  })

  it('recusa horário que não é um instante', () => {
    expect(() => assertEventTimeUsable('ontem de manhã', now)).toThrow(InvalidTelemetryEventError)
  })
})

// Um evento que não mede nada gravaria uma linha só de nulos e queimaria uma
// sequência da sessão, sem contar nada a ninguém.
describe('assertMeasuresSomething', () => {
  it('aceita evento com ao menos uma medição', () => {
    expect(() =>
      assertMeasuresSomething({ heartRate: { value: 82, unit: 'bpm', source: 'APPLE_WATCH' } }),
    ).not.toThrow()
  })

  it('recusa evento sem medição alguma', () => {
    expect(() => assertMeasuresSomething({})).toThrow(InvalidTelemetryEventError)
  })
})
