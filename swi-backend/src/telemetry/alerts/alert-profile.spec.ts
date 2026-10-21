import { FRESHNESS } from '../domain/metric-state'
import {
  ALERT_PROFILE_VERSION,
  CALIBRATED_ALERT_PROFILE,
  CALIBRATED_ALERT_PROFILE_VERSION,
  EXPERIMENTAL_ALERT_PROFILE,
} from './alert-profile'

// A versão é literal e fixada aqui de propósito: mudar limite sem mudar versão
// é proibido, porque a linha da condição grava a versão para a auditoria saber
// com que régua ela foi aberta. Os números são experimentais; o que este spec
// protege é que eles não mudem em silêncio.

describe('perfil de alertas experimental', () => {
  it('tem a versão fixada', () => {
    expect(ALERT_PROFILE_VERSION).toBe('swi-alert-experimental-2')
    expect(EXPERIMENTAL_ALERT_PROFILE.version).toBe(ALERT_PROFILE_VERSION)
  })

  it('é congelado', () => {
    expect(Object.isFrozen(EXPERIMENTAL_ALERT_PROFILE)).toBe(true)
  })

  it('perda de sinal usa o prazo de obsolescência do domínio, não número próprio', () => {
    expect(EXPERIMENTAL_ALERT_PROFILE.signalLost.silenceMs).toBe(FRESHNESS.VITAL.staleMs)
  })

  it('a v2 acrescenta o desgaste alto: abre em 80, recupera abaixo de 70', () => {
    // O 80 é o limiar operacional que a fórmula sempre prometeu; até a v1 ele
    // não abria condição nenhuma. A banda de dez pontos é a mesma da bateria.
    expect(EXPERIMENTAL_ALERT_PROFILE.wearHigh).toEqual({ openAtPercent: 80, recoverBelowPercent: 70 })
  })

  it('os números da v1 continuam os do desenho de 2026-09-07', () => {
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

// Perfil da calibração individual (revisão 2.0), só para a origem REAL. A DEMO
// continua no v2, e por isso ele não pode mudar junto.
describe('perfil de alertas calibrado', () => {
  it('tem a versão fixada e é congelado, por dentro também', () => {
    expect(CALIBRATED_ALERT_PROFILE_VERSION).toBe('swi-alert-calibrated-3')
    expect(CALIBRATED_ALERT_PROFILE.version).toBe(CALIBRATED_ALERT_PROFILE_VERSION)
    expect(Object.isFrozen(CALIBRATED_ALERT_PROFILE)).toBe(true)
    expect(Object.isFrozen(CALIBRATED_ALERT_PROFILE.attention)).toBe(true)
    expect(Object.isFrozen(CALIBRATED_ALERT_PROFILE.bloodPressureHigh)).toBe(true)
  })

  it('a trava de desgaste sobe para 90, recuperando abaixo de 80', () => {
    expect(CALIBRATED_ALERT_PROFILE.wearHigh).toEqual({ openAtPercent: 90, recoverBelowPercent: 80 })
  })

  it('Atenção pede 10 min seguidos no relógio e na pulseira', () => {
    expect(CALIBRATED_ALERT_PROFILE.attention).toEqual({ windowMs: 600_000, minSpanMs: 585_000, maxGapMs: 15_000 })
    expect(CALIBRATED_ALERT_PROFILE.sparseAttention).toEqual({ holdMs: 600_000, maxGapMs: 600_000 })
  })

  it('o desgaste no relógio tem a mesma janela, com vão de até 1 min entre avaliações', () => {
    expect(CALIBRATED_ALERT_PROFILE.wearAttention).toEqual({ windowMs: 600_000, minSpanMs: 540_000, maxGapMs: 60_000 })
    expect(Object.isFrozen(CALIBRATED_ALERT_PROFILE.wearAttention)).toBe(true)
  })

  it('a Atenção de oxigenação pede duas leituras com 10 min ou mais entre elas', () => {
    expect(CALIBRATED_ALERT_PROFILE.oxygenAttention).toEqual({ minApartMs: 600_000 })
    expect(Object.isFrozen(CALIBRATED_ALERT_PROFILE.oxygenAttention)).toBe(true)
  })

  it('as travas novas são as do desenho', () => {
    expect(CALIBRATED_ALERT_PROFILE.oxygenLow).toEqual({ openBelowPercent: 90, recoverAbovePercent: 92 })
    expect(CALIBRATED_ALERT_PROFILE.bloodPressureHigh).toEqual({
      systolicAt: 180,
      diastolicAt: 110,
      systolicRecoverBelow: 160,
      diastolicRecoverBelow: 100,
    })
  })

  it('as travas de batimento e o resto seguem as do v2', () => {
    expect(CALIBRATED_ALERT_PROFILE).toMatchObject({
      heartRateHigh: EXPERIMENTAL_ALERT_PROFILE.heartRateHigh,
      heartRateLow: EXPERIMENTAL_ALERT_PROFILE.heartRateLow,
      persistence: EXPERIMENTAL_ALERT_PROFILE.persistence,
      batteryLow: EXPERIMENTAL_ALERT_PROFILE.batteryLow,
      signalLost: EXPERIMENTAL_ALERT_PROFILE.signalLost,
    })
  })

  it('o v2 da DEMO não muda', () => {
    expect(EXPERIMENTAL_ALERT_PROFILE.version).toBe('swi-alert-experimental-2')
    expect(EXPERIMENTAL_ALERT_PROFILE.wearHigh).toEqual({ openAtPercent: 80, recoverBelowPercent: 70 })
  })
})
