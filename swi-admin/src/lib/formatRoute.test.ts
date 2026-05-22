import { formatDuration, formatDistance } from './formatRoute'

describe('formatDuration', () => {
  it('formats < 60s as "X s"', () => {
    expect(formatDuration(45)).toBe('45 s')
  })

  it('formats < 1h as "X min"', () => {
    expect(formatDuration(60)).toBe('1 min')
    expect(formatDuration(360)).toBe('6 min')
    expect(formatDuration(1020)).toBe('17 min')
  })

  it('formats >= 1h as "Xh Ymin"', () => {
    expect(formatDuration(3600)).toBe('1h 0min')
    expect(formatDuration(3960)).toBe('1h 6min')
  })
})

describe('formatDistance', () => {
  it('formats < 1000m as "X m"', () => {
    expect(formatDistance(450)).toBe('450 m')
  })

  it('formats >= 1000m as "X.X Km" or "X Km"', () => {
    expect(formatDistance(1500)).toBe('1.5 Km')
    expect(formatDistance(16000)).toBe('16 Km')
  })
})
