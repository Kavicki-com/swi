import { dashboardApi } from './dashboard'

describe('dashboardApi.summary', () => {
  it('returns aggregated employee counts by status', async () => {
    const { data, error } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(error).toBeNull()
    expect(data?.employees.total).toBe(12)
    expect(
      data!.employees.byStatus.good +
        data!.employees.byStatus.alert +
        data!.employees.byStatus.low +
        data!.employees.byStatus.offline,
    ).toBe(12)
  })

  it('counts open + acknowledged alerts by severity, ignoring closed', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.alerts.openOrAcknowledged).toBe(2)
    expect(data?.alerts.bySeverity.critical).toBe(1)
    expect(data?.alerts.bySeverity.warning).toBe(1)
    expect(data?.alerts.bySeverity.info).toBe(0)
  })

  it('returns Figma-aligned activities with status, sector and participants', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.activities).toBeDefined()
    expect(data!.activities.length).toBeGreaterThanOrEqual(4)
    const first = data!.activities[0]!
    expect(first).toMatchObject({
      title: expect.any(String),
      sector: expect.any(String),
      progress: expect.any(Number),
    })
    expect(['em-curso', 'concluida', 'a-fazer']).toContain(first.status)
    expect(Array.isArray(first.participants)).toBe(true)
    // Mix of statuses so the chip filter has visible effects
    const statuses = new Set(data!.activities.map((a) => a.status))
    expect(statuses.size).toBeGreaterThan(1)
  })

  it('returns the expanded 6-entry weather timeline with one AGORA marker', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.weather).toHaveLength(6)
    const nowMarkers = data!.weather.filter((w) => w.isNow)
    expect(nowMarkers).toHaveLength(1)
    expect(data!.weather.every((w) => typeof w.label === 'string' && w.label.length > 0)).toBe(true)
  })

  it('returns wear alerts fixture with bpm, pressure and sector', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.wearAlerts).toBeDefined()
    expect(data!.wearAlerts.length).toBeGreaterThanOrEqual(4)
    const first = data!.wearAlerts[0]!
    expect(first).toMatchObject({
      employeeName: expect.any(String),
      sector: expect.any(String),
      progress: expect.any(Number),
      bpm: expect.any(Number),
      pressure: expect.any(String),
    })
  })

  it('returns S1.7 KPI aggregates (vitalSigns, wearRate, urgentAlerts, commonAlerts)', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.kpis).toBeDefined()
    // urgentAlerts = critical + warning open/ack
    expect(data!.kpis.urgentAlerts).toBe(2)
    expect(data!.kpis.commonAlerts).toBe(0)
    expect(typeof data!.kpis.vitalSigns).toBe('number')
    expect(typeof data!.kpis.wearRate).toBe('number')
  })

  it('returns zeros for an unknown org but still emits weather and activities fixture', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_does_not_exist' })
    expect(data?.employees.total).toBe(0)
    expect(data?.alerts.openOrAcknowledged).toBe(0)
    // Activities are a static fixture in S1.7, not org-scoped — they always render.
    expect(data!.activities.length).toBeGreaterThan(0)
    expect(data?.weather).toHaveLength(6)
  })
})
