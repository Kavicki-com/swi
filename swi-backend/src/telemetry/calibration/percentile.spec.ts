import { median, percentile } from './percentile'

describe('percentile (nearest-rank)', () => {
  it('é nulo sem valores', () => {
    expect(percentile([], 50)).toBeNull()
  })
  it('pega o posto ceil(p/100 * n), sem interpolar', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8], 25)).toBe(2)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
    expect(percentile([10, 1, 5], 50)).toBe(5)
  })
  it('p0 é o mínimo e p100 o máximo', () => {
    expect(percentile([3, 1, 2], 0)).toBe(1)
    expect(percentile([3, 1, 2], 100)).toBe(3)
  })
  it('não altera a entrada', () => {
    const values = [3, 1, 2]
    percentile(values, 50)
    expect(values).toEqual([3, 1, 2])
  })
})

describe('median', () => {
  it('é nula sem valores', () => {
    expect(median([])).toBeNull()
  })
  it('média dos dois do meio quando par, como o repouso', () => {
    expect(median([1, 3, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})
