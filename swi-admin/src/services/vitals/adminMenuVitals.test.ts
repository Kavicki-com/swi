// describe/it/expect vêm dos globals do Vitest.
import { metric, reporting } from '@/test-utils/telemetryFixtures'
import { adminMenuVitalsFrom } from './adminVitals'

const PROFILE = { role: 'Coordenadora', sector: 'Operações' }

describe('adminMenuVitalsFrom', () => {
  // Administrador não pareia aparelho: nenhum número de vital é afirmado.
  it('sem aparelho declara a ausência em todos os campos', () => {
    const v = adminMenuVitalsFrom({
      profile: PROFILE,
      device: 'none',
      telemetry: null,
      failed: false,
    })
    expect(v).toEqual({
      role: 'Coordenadora',
      sector: 'Operações',
      heartRate: '--',
      showPulse: false,
      status: 'Sem aparelho',
      mpm: '--',
      mpmPercent: 0,
      fatigue: 'Sem estimativa',
      fatiguePercent: 0,
      temperature: '--',
      temperaturePercent: 0,
      battery: '--',
      batteryPercent: 0,
    })
  })

  it('perfil ainda não carregado não inventa cargo nem setor', () => {
    const v = adminMenuVitalsFrom({ profile: null, device: 'none', telemetry: null, failed: false })
    expect(v.role).toBeNull()
    expect(v.sector).toBeNull()
  })

  it('com aparelho e leitura atual mostra os valores medidos', () => {
    const t = reporting({
      movementPerMinute: metric(23),
      battery: metric(64),
      bodyTemperature: metric(36.4, { source: 'MANUAL_HEALTHKIT' }),
    })
    const v = adminMenuVitalsFrom({
      profile: PROFILE,
      device: 'paired',
      telemetry: t,
      failed: false,
    })
    expect(v.heartRate).toBe('112')
    expect(v.showPulse).toBe(true)
    expect(v.status).toBe('Monitorando agora')
    expect(v.mpm).toBe('23 mpm')
    expect(v.mpmPercent).toBe(23)
    expect(v.fatigue).toBe('95 minutos')
    expect(v.fatiguePercent).toBe(38.4)
    expect(v.temperature).toBe('36,4°C')
    expect(v.battery).toBe('64%')
    expect(v.batteryPercent).toBe(64)
  })

  it('com aparelho e falha na leitura não mostra pulso nem número', () => {
    const v = adminMenuVitalsFrom({
      profile: PROFILE,
      device: 'paired',
      telemetry: null,
      failed: true,
    })
    expect(v.heartRate).toBe('--')
    expect(v.showPulse).toBe(false)
    expect(v.status).toBe('Leitura indisponível no momento')
  })
})
