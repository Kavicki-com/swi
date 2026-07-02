describe('reports selector', () => {
  it('usa a impl mock quando DATA_BACKEND=mock (default)', async () => {
    const { reportsApi } = await import('./reports')
    const { reportsApi: mock } = await import('./mockApi/reports')
    expect(reportsApi).toBe(mock)
  })

  it('o stub amplify lança "não deployado" em qualquer método', async () => {
    const { reportsApi } = await import('./amplifyApi/reports')
    await expect(async () => (reportsApi as { list: () => unknown }).list()).rejects.toThrow(
      /não deployado/,
    )
  })
})
