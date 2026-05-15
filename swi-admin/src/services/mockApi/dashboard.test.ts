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
    // Demo expansion (was 5 per Figma): now 8 activities across all 4 sectors
    // so the dashboard reads as a fully-populated ops board for clients.
    expect(data!.activities.length).toBe(8)
    const first = data!.activities[0]!
    expect(first).toMatchObject({
      title: expect.any(String),
      sector: expect.any(String),
      progress: expect.any(Number),
    })
    expect(Array.isArray(first.participants)).toBe(true)
    // Demo expansion: activities now span all 3 status tabs so the filter
    // chips populate (was: all 5 em-curso). At least one of each status.
    const statuses = new Set(data!.activities.map((a) => a.status))
    expect(statuses.has('em-curso')).toBe(true)
    expect(statuses.has('concluida')).toBe(true)
    expect(statuses.has('a-fazer')).toBe(true)
  })

  it('returns the 4-entry weather timeline with one AGORA marker', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.weather).toHaveLength(4)
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

  it('returns the full S1.7 KPI aggregates (Figma frame 4:2)', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.kpis).toBeDefined()
    // urgentAlerts = critical + warning open/ack
    expect(data!.kpis.urgentAlerts).toBe(2)
    expect(data!.kpis.commonAlerts).toBe(0)
    // Funcionarios 2x2 grid values match the Figma reference exactly.
    // 8 admins after demo expansion (roster: Elisa + Mathias + João + 5 added).
    expect(data!.kpis.admins).toBe(8)
    expect(data!.kpis.totalEmployees).toBe(1205)
    expect(data!.kpis.newReports).toBe(4)
    expect(data!.kpis.activeCameras).toBe(564)
    expect(data!.kpis.vitalSigns).toBe(512)
    expect(data!.kpis.wearRate).toBe(512)
  })

  it('returns zeros for an unknown org but still emits weather and activities fixture', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_does_not_exist' })
    expect(data?.employees.total).toBe(0)
    expect(data?.alerts.openOrAcknowledged).toBe(0)
    // Activities are a static fixture in S1.7, not org-scoped — they always render.
    expect(data!.activities.length).toBeGreaterThan(0)
    expect(data?.weather).toHaveLength(4)
  })
})
