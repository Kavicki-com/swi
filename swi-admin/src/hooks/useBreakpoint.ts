// src/hooks/useBreakpoint.ts
//
// Single source of truth for viewport class.
//
// Uses react-native's useWindowDimensions (provided by react-native-web in
// this app), which keeps the hook consistent with the rest of the codebase
// — the layout already reads viewport via RN primitives elsewhere.
//
// Boundaries (see docs/plans/2026-05-15-swi-admin-responsive-system-design.md):
//   - 640 px is the phone boundary. iPhone 17 reports 393 CSS px; the largest
//     phone in portrait (iPhone Pro Max class) reports ~440. 640 picks up
//     every phone in portrait while leaving the smallest iPad mini (768) on
//     the tablet side. Below this we collapse the tablet top-bar (Logo +
//     "Menu" + HeaderUserInfo widget — ~540 px wide) to a slimmer shell
//     with hamburger + Logo + avatar-only.
//   - 1024 px is the cut where the 228 px sidebar can no longer sit next to
//     a usable content column, so below it we collapse the sidebar to a
//     top-bar drawer.
//   - 1500 px is the wide threshold. CSS pixels, not monitor pixels: a 1920
//     monitor running Windows DPI scaling at 125 % (the common default)
//     reports 1536 CSS px to the browser, so 1500 picks up the typical
//     1920 desktop while still requiring genuine horizontal headroom.
import { useWindowDimensions } from 'react-native'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop' | 'wide'

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions()
  if (width < 640) return 'mobile'
  if (width < 1024) return 'tablet'
  if (width < 1500) return 'desktop'
  return 'wide'
}
