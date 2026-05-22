import { useAdminVitals } from './adminVitals'

describe('useAdminVitals', () => {
  it('returns the reference persona + vitals from FRONT-END-SWI.pdf §1.1', () => {
    const v = useAdminVitals()
    expect(v.role).toBe('Engenheiro hidráulico')
    expect(v.sector).toBe('Setor Norte n-002')
    expect(v.heartRate).toBe(72)
    expect(v.status).toBe('perfeitas condições')
    expect(v.mpm).toBe(23)
    expect(v.fatigueHours).toBe(3)
    expect(v.fatigueMinutes).toBe(13)
    expect(v.temperature).toBe(36.5)
    expect(v.battery).toBe(78)
  })

  it('exposes a progress percent for every metric in 0..100 range', () => {
    const v = useAdminVitals()
    for (const p of [v.mpmPercent, v.fatiguePercent, v.temperaturePercent, v.batteryPercent]) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(100)
    }
  })
})
