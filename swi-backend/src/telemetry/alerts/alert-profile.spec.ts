import { FRESHNESS } from '../domain/metric-state'
import { ALERT_PROFILE_VERSION, EXPERIMENTAL_ALERT_PROFILE } from './alert-profile'

// A versão é literal e fixada aqui de propósito: mudar limite sem mudar versão
// é proibido, porque a linha da condição grava a versão para a auditoria saber
// com que régua ela foi aberta. Os números são experimentais; o que este spec
// protege é que eles não mudem em silêncio.

describe('perfil de alertas experimental', () => {
  it('tem a versão fixada', () => {
    expect(ALERT_PROFILE_VERSION).toBe('swi-alert-experimental-1')
    expect(EXPERIMENTAL_ALERT_PROFILE.version).toBe(ALERT_PROFILE_VERSION)
  })

  it('é congelado', () => {
    expect(Object.isFrozen(EXPERIMENTAL_ALERT_PROFILE)).toBe(true)
  })

  it('perda de sinal usa o prazo de obsolescência do domínio, não número próprio', () => {
    expect(EXPERIMENTAL_ALERT_PROFILE.signalLost.silenceMs).toBe(FRESHNESS.VITAL.staleMs)
  })

  it('os números da v1 são os do desenho de 2026-09-07', () => {
    expect(EXPERIMENTAL_ALERT_PROFILE).toMatchObject({
      heartRateHigh: { maxFraction: 0.9, floorBpm: 180, hysteresisBpm: 10 },
      heartRateLow: { belowRestingBpm: 15, floorBpm: 40, hysteresisBpm: 10 },
      persistence: { windowMs: 60_000, minSpanMs: 45_000, maxGapMs: 15_000 },
      batteryLow: { openAtPercent: 15, recoverAbovePercent: 25 },
      bloodPressureReview: { systolicAt: 140, diastolicAt: 90, systolicRecoverBelow: 130, diastolicRecoverBelow: 85 },
      signalLost: { shiftCeilingMs: 8 * 60 * 60 * 1000 },
      restingDays: 14,
    })
  })
})
