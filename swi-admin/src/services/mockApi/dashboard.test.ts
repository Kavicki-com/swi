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

  it('returns alert counts by severity (open + acknowledged only)', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.alerts.openOrAcknowledged).toBeGreaterThan(0)
    expect(data?.alerts.bySeverity.critical).toBeGreaterThanOrEqual(0)
  })

  it('returns the 5 most recent activities sorted desc', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.recentActivities).toHaveLength(5)
    const timestamps = data!.recentActivities.map((a) => a.at)
    const sorted = [...timestamps].sort((a, b) => (a < b ? 1 : -1))
    expect(timestamps).toEqual(sorted)
  })

  it('returns weather timeline placeholder (3 entries)', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data?.weather).toHaveLength(3)
  })
})
