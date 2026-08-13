// src/pages/maps/components/HeatmapLegend.tsx
// Barra vertical de intensidade do mapa de calor. Extraída de MapsGeneral.tsx
// sem mudança de comportamento.
import { useTheme } from '@kavicki/swi-design-system'

/* Intensity legend (map-view-heat reference): a slim full-height
   vertical gradient bar pinned to the right edge with "Intensity /
   High Red" labels at the top. The "Low" label is intentionally
   omitted to match the reference, where the bar fades into the screen edge.
   No background panel; labels float directly over the satellite
   imagery, kept legible by a strong drop-shadow. The bar lives at
   right:6, width 16, so it occupies x range vp-22..vp-6. Map controls
   now use right:56 (instead of 16) to keep their 48px-wide icons from
   overlapping the bar. The container stops at bottom:114, just above
   the "Voltar ao dashboard" button (bottom:30 + height ~72 + 12 gap)
   so the gradient doesn't bleed behind it. */
export function HeatmapLegend({ visible }: { visible: boolean }) {
  const theme = useTheme()
  if (!visible) return null
  return (
    <div
      style={{
        position: 'absolute',
        right: 6,
        top: 90,
        bottom: 114,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
        zIndex: 2,
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 600,
          color: theme.content.dark,
          letterSpacing: 0.3,
          lineHeight: '14px',
          textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.6)',
          paddingRight: 4,
        }}
      >
        Intensity
      </span>
      <span
        style={{
          fontSize: 11,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 700,
          color: '#fda4af',
          letterSpacing: 0.3,
          lineHeight: '13px',
          textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.6)',
          paddingRight: 4,
        }}
      >
        High Red
      </span>
      <div
        style={{
          width: 16,
          flex: 1,
          borderRadius: 4,
          background:
            'linear-gradient(180deg, #9f1239 0%, #dc2626 14%, #f97316 32%, #facc15 52%, #22c55e 74%, #22d3ee 100%)',
          boxShadow:
            '0 0 12px rgba(0,0,0,0.7), 0 0 24px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.28)',
          marginTop: 6,
        }}
      />
    </div>
  )
}
