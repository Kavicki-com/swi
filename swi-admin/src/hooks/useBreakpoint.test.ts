// src/hooks/useBreakpoint.test.ts
//
// Unit tests for the breakpoint classifier. We stub react-native's
// useWindowDimensions per-test so the hook sees a deterministic width
// independent of jsdom's default viewport.
import { renderHook } from '@testing-library/react'

const useWindowDimensionsMock =
  vi.fn<() => { width: number; height: number; scale: number; fontScale: number }>()

vi.mock('react-native', () => ({
  useWindowDimensions: () => useWindowDimensionsMock(),
}))

// Imported after vi.mock so the module under test resolves the mocked
// react-native, not the real one.
import { useBreakpoint } from './useBreakpoint'

const dims = (width: number) => ({ width, height: 900, scale: 1, fontScale: 1 })

describe('useBreakpoint', () => {
  afterEach(() => {
    useWindowDimensionsMock.mockReset()
  })

  it('returns "mobile" for phone-class viewports (< 640)', () => {
    // iPhone 17 base width is 393. Anything below the 640 boundary
    // collapses to the single-column mobile shell.
    useWindowDimensionsMock.mockReturnValue(dims(393))
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')
  })

  it('returns "mobile" exactly at the boundary minus one (639)', () => {
    useWindowDimensionsMock.mockReturnValue(dims(639))
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')
  })

  it('returns "tablet" for tablet-class viewports (640 ≤ w < 1024)', () => {
    useWindowDimensionsMock.mockReturnValue(dims(800))
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('tablet')
  })

  it('returns "tablet" exactly at the lower boundary (640)', () => {
    useWindowDimensionsMock.mockReturnValue(dims(640))
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('tablet')
  })

  it('returns "desktop" for the canonical Figma viewport (1024 ≤ w < 1500)', () => {
    useWindowDimensionsMock.mockReturnValue(dims(1366))
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })

  it('returns "wide" for >= 1500 viewports (covers 1920 monitor at 125 % DPI scale)', () => {
    useWindowDimensionsMock.mockReturnValue(dims(1536))
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('wide')
  })
})
