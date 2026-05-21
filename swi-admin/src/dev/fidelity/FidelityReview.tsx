// EXPERIMENTAL — DEV ONLY. Side-by-side Figma vs live admin for fidelity review.
// Gated by import.meta.env.DEV at the route level (see App.tsx).
// If this experiment fails the validation criteria, delete swi-admin/src/dev/fidelity.
import { useEffect, useMemo, useRef, useState } from 'react'
import frameSnapshot from './snapshots/dashboard-frame-4-2.png'

const FRAME_WIDTH = 1366
const FRAME_HEIGHT = 1329

type FocusRect = { x: number; y: number; w: number; h: number }

type SectionDef = {
  name: string
  label: string
  figmaFocus: FocusRect
  liveSelector: string
}

const SECTIONS = [
  {
    name: 'header',
    label: 'Header — top-right user info strip',
    figmaFocus: { x: 1040, y: 0, w: 326, h: 96 },
    liveSelector: '[data-fidelity="header"]',
  },
  {
    name: 'sidebar',
    label: 'Sidebar — logo, nav, chat list, sign out',
    figmaFocus: { x: 40, y: 112, w: 228, h: 865 },
    liveSelector: '[data-fidelity="sidebar"]',
  },
  {
    name: 'map-banner',
    label: 'Map banner — top of dashboard',
    figmaFocus: { x: 284, y: 112, w: 1037, h: 172 },
    liveSelector: '[data-fidelity="map-banner"]',
  },
  {
    name: 'kpi-row',
    label: 'KPI row — funcionários, sinais vitais, taxa desgaste, alertas',
    figmaFocus: { x: 284, y: 316, w: 1037, h: 263 },
    liveSelector: '[data-fidelity="kpi-row"]',
  },
  {
    name: 'activities',
    label: 'Atividades em andamento — coluna esquerda da row de baixo',
    figmaFocus: { x: 284, y: 611, w: 500, h: 441 },
    liveSelector: '[data-fidelity="activities"]',
  },
  {
    name: 'wear-alerts',
    label: 'Alertas de desgaste — coluna direita da row de baixo',
    figmaFocus: { x: 816, y: 611, w: 500, h: 465 },
    liveSelector: '[data-fidelity="wear-alerts"]',
  },
  {
    name: 'weather',
    label: 'Previsão do tempo — banner inferior do dashboard',
    figmaFocus: { x: 284, y: 1108, w: 1037, h: 162 },
    liveSelector: '[data-fidelity="weather"]',
  },
] as const satisfies ReadonlyArray<SectionDef>

const DEFAULT_SECTION: SectionDef = SECTIONS[0]

const NOTES_ENDPOINT = '/__fidelity/notes'
const SAVE_DEBOUNCE_MS = 500

type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'saving' }
  | { kind: 'saved'; path: string; at: string; bytes: number }
  | { kind: 'error'; message: string }

export function FidelityReview() {
  const [sectionName, setSectionName] = useState<string>(DEFAULT_SECTION.name)
  const [focused, setFocused] = useState<boolean>(true)
  const [notes, setNotes] = useState<string>('')
  const [sync, setSync] = useState<SyncStatus>({ kind: 'idle' })
  const dirtyRef = useRef<boolean>(false)

  const section: SectionDef = useMemo(
    () => SECTIONS.find((s) => s.name === sectionName) ?? DEFAULT_SECTION,
    [sectionName],
  )

  useEffect(() => {
    let cancelled = false
    dirtyRef.current = false
    setSync({ kind: 'loading' })
    fetch(`${NOTES_ENDPOINT}?section=${encodeURIComponent(section.name)}`)
      .then((r) => r.json())
      .then((data: { ok: boolean; content?: string; path?: string; error?: string }) => {
        if (cancelled) return
        if (!data.ok) {
          setSync({ kind: 'error', message: data.error ?? 'failed to load notes' })
          return
        }
        setNotes(data.content ?? '')
        setSync({ kind: 'idle' })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setSync({ kind: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [section.name])

  useEffect(() => {
    if (!dirtyRef.current) return
    const handle = setTimeout(() => {
      setSync({ kind: 'saving' })
      fetch(NOTES_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ section: section.name, content: notes }),
      })
        .then((r) => r.json())
        .then((data: { ok: boolean; path?: string; bytes?: number; error?: string }) => {
          if (!data.ok) {
            setSync({ kind: 'error', message: data.error ?? 'failed to save' })
            return
          }
          setSync({
            kind: 'saved',
            path: data.path ?? '',
            bytes: data.bytes ?? 0,
            at: new Date().toLocaleTimeString(),
          })
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          setSync({ kind: 'error', message })
        })
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [notes, section.name])

  const handleNotesChange = (value: string) => {
    dirtyRef.current = true
    setNotes(value)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#0b0d12',
        color: '#e6e8ee',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: '8px 16px',
          background: '#11141b',
          borderBottom: '1px solid #1f2330',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          flex: '0 0 auto',
        }}
      >
        <strong style={{ fontSize: 13, letterSpacing: 0.4 }}>FIDELITY REVIEW · DEV ONLY</strong>
        <span style={{ opacity: 0.5, fontSize: 11 }}>
          frame 4:2 · {FRAME_WIDTH}×{FRAME_HEIGHT}
        </span>
        <select
          value={section.name}
          onChange={(e) => setSectionName(e.target.value)}
          style={{
            padding: '4px 8px',
            background: '#1f2330',
            color: '#e6e8ee',
            border: '1px solid #2a2f3d',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {SECTIONS.map((s) => (
            <option key={s.name} value={s.name}>
              {s.label}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={focused} onChange={(e) => setFocused(e.target.checked)} />
          Focus on section
        </label>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            color: syncColor(sync),
          }}
        >
          {syncLabel(sync)}
        </span>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <FigmaPanel section={section} focused={focused} />
        <LivePanel section={section} focused={focused} />
      </div>

      <footer
        style={{
          padding: 12,
          background: '#11141b',
          borderTop: '1px solid #1f2330',
          flex: '0 0 auto',
        }}
      >
        <textarea
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          placeholder={`Notas de divergência para "${section.name}". Liste o que está diferente entre Figma e live (cor, spacing, conteúdo, ícone, layout). Eu vou ler isso e corrigir.`}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 96,
            background: '#0b0d12',
            color: '#e6e8ee',
            border: '1px solid #2a2f3d',
            borderRadius: 4,
            padding: 8,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 12,
            resize: 'vertical',
          }}
        />
      </footer>
    </div>
  )
}

function FigmaPanel({ section, focused }: { section: SectionDef; focused: boolean }) {
  const { figmaFocus } = section
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        overflow: 'auto',
        background: '#000',
        borderRight: '1px solid #1f2330',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '6px 12px',
          background: '#0d6efd',
          color: '#fff',
          fontSize: 11,
          letterSpacing: 0.4,
          fontWeight: 600,
        }}
      >
        FIGMA · {section.name}
        {focused
          ? ` · crop ${figmaFocus.w}×${figmaFocus.h} @ (${figmaFocus.x},${figmaFocus.y})`
          : ' · full frame'}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {focused ? (
          <div
            style={{
              width: figmaFocus.w,
              height: figmaFocus.h,
              overflow: 'hidden',
              outline: '1px dashed #2a2f3d',
            }}
          >
            <img
              src={frameSnapshot}
              alt={`Figma frame 4:2 cropped to ${section.name}`}
              draggable={false}
              style={{
                marginLeft: -figmaFocus.x,
                marginTop: -figmaFocus.y,
                width: FRAME_WIDTH,
                height: FRAME_HEIGHT,
                display: 'block',
                userSelect: 'none',
              }}
            />
          </div>
        ) : (
          <img
            src={frameSnapshot}
            alt="Figma frame 4:2"
            draggable={false}
            style={{ width: '100%', display: 'block', userSelect: 'none' }}
          />
        )}
      </div>
    </div>
  )
}

function LivePanel({ section, focused }: { section: SectionDef; focused: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '6px 12px',
          background: '#28a745',
          color: '#fff',
          fontSize: 11,
          letterSpacing: 0.4,
          fontWeight: 600,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span>LIVE · {section.liveSelector}</span>
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          style={{ color: '#fff', textDecoration: 'underline', fontSize: 11 }}
        >
          open standalone ↗
        </a>
        {focused && (
          <span style={{ opacity: 0.85, fontSize: 11 }}>
            scroll iframe manually to header (top-right)
          </span>
        )}
      </div>
      <iframe
        title={`Live admin · ${section.name}`}
        src="/"
        style={{ flex: 1, border: 'none', width: '100%', background: '#fff' }}
      />
    </div>
  )
}

function syncLabel(s: SyncStatus): string {
  switch (s.kind) {
    case 'idle':
      return '· idle'
    case 'loading':
      return '· loading from disk…'
    case 'saving':
      return '· saving…'
    case 'saved':
      return `✓ saved → ${s.path} · ${s.bytes}b · ${s.at}`
    case 'error':
      return `✗ ${s.message}`
  }
}

function syncColor(s: SyncStatus): string {
  switch (s.kind) {
    case 'idle':
      return 'rgba(230, 232, 238, 0.4)'
    case 'loading':
    case 'saving':
      return '#f0c674'
    case 'saved':
      return '#5fb37c'
    case 'error':
      return '#e06c75'
  }
}
