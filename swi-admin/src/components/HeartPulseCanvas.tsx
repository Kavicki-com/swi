// src/components/HeartPulseCanvas.tsx
// Continuous ECG-style heart pulse line for the header user-details menu
// (QA cliente §1.1). Direct port of the client reference
// software/dashboard.html (lines 889-988) — same time-based sampling and
// step values for P/Q/R/S/T so the visual shape (long flat baseline + tall
// R spike + small rectangular S/T plateau) matches Screenshot_31 exactly.
import { useEffect, useRef } from 'react'

export interface HeartPulseCanvasProps {
  width?: number
  height?: number
  // Stroke color. Reference uses `#084614`; we override at call-site to
  // theme.surface.success for brand alignment.
  color?: string
  // Glow shadow color (matches stroke by default).
  glowColor?: string
  // Pixels of horizontal scroll per animation tick.
  step?: number
  // Beats per minute — controls the cycle period for ecgSample.
  bpm?: number
}

// Step-shaped ECG sample. Same structure as dashboard.html
// `getElectroValue()` but with wider P/T windows + larger amplitudes so
// the rectangular "step plateaus" before/after the R spike are visible
// instead of single-frame blips — matches the client target Screenshot_33
// (long flat → step rectangle → tall spike → step rectangle → flat).
function ecgSample(cycle: number): number {
  // Full PQRST as RECTANGULAR steps with WIDE baseline gaps between
  // P, R and T (matching Screenshot_42): P early in the cycle, R in the
  // middle, T late — each separated by a long flat segment. Q and S
  // remain tight against R as the short downward dips of the QRS complex.
  if (cycle > 0.05 && cycle < 0.1) return -25 // P plateau (early ↑)
  if (cycle > 0.2 && cycle < 0.22) return 25 // Q step (↓ just before R)
  if (cycle > 0.22 && cycle < 0.24) return -120 // R spike (off canvas top)
  if (cycle > 0.24 && cycle < 0.26) return 25 // S step (↓ just after R)
  if (cycle > 0.36 && cycle < 0.45) return -35 // T plateau (late ↑)
  return 0
}

export function HeartPulseCanvas({
  width = 300,
  height = 80,
  color = '#1F8F36',
  glowColor,
  step = 2,
  bpm = 75,
}: HeartPulseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // High-DPI for crisp lines without changing layout dimensions.
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.scale(dpr, dpr)
    const centerY = height / 2
    // Trail of plotted points scrolling right→left. Seed with the FULL
    // ECG pattern across the canvas (computing what each x position
    // corresponds to in past time) so multiple beats are visible the
    // moment the menu opens. Without this seed only the latest beat is
    // drawn — and rAF throttling (when the tab loses focus) makes the
    // canvas look almost empty.
    const points: { x: number; y: number }[] = []
    const seedNow = Date.now() / 1000
    const framesPerSec = 60
    for (let x = 0; x <= width; x += step) {
      const framesAgo = (width - x) / step
      const t = seedNow - framesAgo / framesPerSec
      const cycle = (((t * (bpm / 60)) % 1) + 1) % 1
      const rawY = centerY + ecgSample(cycle)
      const clampedY = Math.max(4, Math.min(height - 4, rawY))
      points.push({ x, y: clampedY })
    }
    let rafId = 0
    const draw = () => {
      const now = Date.now() / 1000
      const cycle = (((now * (bpm / 60)) % 1) + 1) % 1
      const sample = ecgSample(cycle)
      // Clamp Y to a small inset from the canvas top (4 px) so the R-spike
      // apex stays IN the canvas — both legs then connect with a visible
      // horizontal segment at the top, instead of clipping off-canvas with
      // an open gap. Matches the "fechar em cima" expectation from
      // Screenshot_40 feedback.
      const rawY = centerY + sample
      const clampedY = Math.max(4, Math.min(height - 4, rawY))
      points.push({ x: width, y: clampedY })
      for (const p of points) p.x -= step
      while (points.length > 0 && points[0]!.x < 0) points.shift()
      ctx.clearRect(0, 0, width, height)
      ctx.beginPath()
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.strokeStyle = color
      ctx.shadowBlur = 10
      ctx.shadowColor = glowColor ?? color
      points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.stroke()
      rafId = requestAnimationFrame(draw)
    }
    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [width, height, color, glowColor, step, bpm])

  return <canvas ref={canvasRef} aria-hidden style={{ display: 'block' }} />
}
