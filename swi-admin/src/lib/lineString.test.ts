import { lngLatAlongLineString, totalLineLength } from './lineString'

describe('lngLatAlongLineString', () => {
  it('returns the first point at t=0', () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    expect(lngLatAlongLineString(coords, 0)).toEqual([0, 0])
  })

  it('returns the last point at t=1', () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    expect(lngLatAlongLineString(coords, 1)).toEqual([10, 10])
  })

  it('returns the midpoint of a single segment at t=0.5', () => {
    const result = lngLatAlongLineString(
      [
        [0, 0],
        [10, 0],
      ],
      0.5,
    )
    expect(result[0]).toBeCloseTo(5)
    expect(result[1]).toBeCloseTo(0)
  })

  it('interpolates along multi-segment polylines weighted by length', () => {
    // 3 segments of length 10 each. total=30. t=0.5 -> 15 accumulated -> midpoint of 2nd segment -> (10, 5)
    const coords: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
    ]
    const result = lngLatAlongLineString(coords, 0.5)
    expect(result[0]).toBeCloseTo(10)
    expect(result[1]).toBeCloseTo(5)
  })

  it('clamps t outside [0, 1]', () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [10, 0],
    ]
    expect(lngLatAlongLineString(coords, -1)).toEqual([0, 0])
    expect(lngLatAlongLineString(coords, 2)).toEqual([10, 0])
  })
})

describe('totalLineLength', () => {
  it('sums euclidean distances between consecutive coords', () => {
    expect(
      totalLineLength([
        [0, 0],
        [3, 4],
      ]),
    ).toBeCloseTo(5)
    expect(
      totalLineLength([
        [0, 0],
        [3, 4],
        [3, 0],
      ]),
    ).toBeCloseTo(9)
  })

  it('returns 0 for empty or single-point input', () => {
    expect(totalLineLength([])).toBe(0)
    expect(totalLineLength([[1, 2]])).toBe(0)
  })
})
