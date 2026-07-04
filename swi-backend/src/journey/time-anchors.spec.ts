import { startAnchors, pauseAnchors, resumeAnchors, endAnchors, elapsedSeconds, progressPct, type Anchors } from './time-anchors'

const A: Anchors = { startedAt: null, accumulatedSeconds: 0, running: false }
const T0 = 1_000_000_000_000

describe('time-anchors (porta pura do progress.ts mobile)', () => {
  it('elapsed parado = accumulated', () => {
    expect(elapsedSeconds({ ...A, accumulatedSeconds: 42 }, T0)).toBe(42)
  })
  it('elapsed rodando soma o segmento atual', () => {
    expect(elapsedSeconds({ startedAt: T0, accumulatedSeconds: 10, running: true }, T0 + 5000)).toBe(15)
  })
  it('start → pause banca o segmento; resume → end acumula', () => {
    const s = startAnchors(A, T0)                       // running, startedAt=T0
    const p = pauseAnchors(s, T0 + 30_000)              // banca 30s, para
    expect(p).toEqual({ startedAt: null, accumulatedSeconds: 30, running: false })
    const r = resumeAnchors(p, T0 + 60_000)             // running de novo
    const e = endAnchors(r, T0 + 60_000 + 10_000)       // +10s
    expect(e.accumulatedSeconds).toBe(40)
    expect(e.running).toBe(false)
  })
  it('progressPct clampa em 100 e trata estimated<=0', () => {
    expect(progressPct(1800, 60)).toBe(50)              // 30min de 60min
    expect(progressPct(999999, 60)).toBe(100)
    expect(progressPct(10, 0)).toBe(0)
  })
  it('startAnchors já-rodando é no-op (não re-ancora, não perde o segmento)', () => {
    const running = { startedAt: T0, accumulatedSeconds: 10, running: true }
    const again = startAnchors(running, T0 + 300_000) // 5min depois, duplo-tap
    expect(again).toEqual(running)                     // âncora intacta → startedAt segue em T0
    expect(elapsedSeconds(again, T0 + 300_000)).toBe(310) // 10 banked + 300s corridos preservados
  })

  it('resumeAnchors já-rodando é no-op (idempotente)', () => {
    const running = { startedAt: T0, accumulatedSeconds: 40, running: true }
    expect(resumeAnchors(running, T0 + 120_000)).toEqual(running)
  })

  it('startAnchors parado→rodando ainda ancora (transição legítima)', () => {
    const stopped = { startedAt: null, accumulatedSeconds: 40, running: false }
    expect(startAnchors(stopped, T0)).toEqual({ startedAt: T0, accumulatedSeconds: 40, running: true })
  })
})
