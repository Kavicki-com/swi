// src/components/AnimatedProgressBar.tsx
// Thin progress bar that grows from 0 → percent on mount, used in the
// header user-details menu (QA cliente §1.1). Visual ports the
// `.barra-progresso-card3` + `growBar` keyframe from the client reference
// software/style.css (300×12, white track + 2px inset, green fill).
//
// DS already exports a ProgressBar component, but its visual (gradient
// tones, MonitoringLayout activity rows) doesn't match this reference. A
// local component keeps the menu pixel-faithful without bumping the DS.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useTheme } from '@kavicki/swi-design-system'

export interface AnimatedProgressBarProps {
  percent: number
  width?: number
  height?: number
  // Fill color. Defaults to theme.surface.success (verde) per the reference.
  color?: string
  // Animation duration in ms. Reference: 2s ease-out.
  durationMs?: number
}

export function AnimatedProgressBar({
  percent,
  width = 300,
  height = 12,
  color,
  durationMs = 2000,
}: AnimatedProgressBarProps) {
  const theme = useTheme()
  // Start at 0, snap to target on mount so the CSS transition animates.
  const [renderedPercent, setRenderedPercent] = useState(0)
  useEffect(() => {
    // rAF ensures the initial 0 width paints before we switch to target,
    // otherwise React batches and the transition never fires.
    const handle = requestAnimationFrame(() => {
      setRenderedPercent(Math.max(0, Math.min(100, percent)))
    })
    return () => cancelAnimationFrame(handle)
  }, [percent])
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ now: percent, min: 0, max: 100 }}
      style={{
        width,
        height,
        backgroundColor: theme.content.dark,
        borderRadius: 3,
        padding: 2,
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${renderedPercent}%`,
          height: '100%',
          backgroundColor: color ?? theme.surface.success,
          borderRadius: 2,
          transition: `width ${durationMs}ms ease-out`,
        }}
      />
    </View>
  )
}
