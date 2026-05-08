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

  it('returns the 5 most recent activities sorted desc', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.recentActivities).toHaveLength(5)
    expect(data!.recentActivities[0]).toMatchObject({
      id: 'a_001',
      label: 'Frequência cardíaca elevada',
    })
    expect(data!.recentActivities[0]?.at).toEqual(expect.any(String))
    const timestamps = data!.recentActivities.map((a) => a.at)
    expect(timestamps).toEqual([...timestamps].sort().reverse())
  })

  it('returns weather timeline placeholder (3 entries)', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.weather).toHaveLength(3)
  })

  it('returns zeros for an unknown org but still emits weather', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_does_not_exist' })
    expect(data?.employees.total).toBe(0)
    expect(data?.alerts.openOrAcknowledged).toBe(0)
    expect(data?.recentActivities).toHaveLength(0)
    expect(data?.weather).toHaveLength(3)
  })
})
