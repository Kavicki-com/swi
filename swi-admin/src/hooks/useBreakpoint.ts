// src/hooks/useBreakpoint.ts
//
// Single source of truth for viewport class.
//
// Uses react-native's useWindowDimensions (provided by react-native-web in
// this app), which keeps the hook consistent with the rest of the codebase
// — the layout already reads viewport via RN primitives elsewhere.
//
// Boundaries (see docs/plans/2026-05-15-swi-admin-responsive-system-design.md):
//   - 1024 px is the cut where the 228 px sidebar can no longer sit next to
//     a usable content column, so below it we collapse the sidebar to a
//     top-bar drawer.
//   - 1600 px is the threshold where there's real room to add an extra
//     content column on the Dashboard top row (Map | Charts | KPIs).
import { useWindowDimensions } from 'react-native'

export type Breakpoint = 'tablet' | 'desktop' | 'wide'

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions()
  if (width < 1024) return 'tablet'
  if (width < 1600) return 'desktop'
  return 'wide'
}
