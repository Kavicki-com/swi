import { sleep } from './sleep'

describe('sleep', () => {
  it('resolves after the given milliseconds', async () => {
    const start = performance.now()
    await sleep(50)
    const elapsed = performance.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45)
    expect(elapsed).toBeLessThan(200)
  })
})
