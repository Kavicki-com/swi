// src/hooks/useBreakpoint.test.ts
//
// Unit tests for the breakpoint classifier. We stub react-native's
// useWindowDimensions per-test so the hook sees a deterministic width
// independent of jsdom's default viewport.
import { renderHook } from '@testing-library/react'

const useWindowDimensionsMock = vi.fn<
  () => { width: number; height: number; scale: number; fontScale: number }
>()

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

  it('returns "tablet" for narrow viewports (< 1024)', () => {
    useWindowDimensionsMock.mockReturnValue(dims(800))
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('tablet')
  })

  it('returns "desktop" for the canonical Figma viewport (1024 ≤ w < 1600)', () => {
    useWindowDimensionsMock.mockReturnValue(dims(1366))
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })

  it('returns "wide" for >= 1600 viewports', () => {
    useWindowDimensionsMock.mockReturnValue(dims(1920))
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('wide')
  })
})
