// src/pages/maps/MapsGeneral.tsx
// Maps · General view — full-bleed satellite map with floating overlays:
// compact left side-menu, three right-side MapControls (operators/heatmap/cameras),
// and a "Voltar ao dashboard" CTA.
//
// O estado, o ciclo de vida do mapa e as camadas moram em
// ./hooks/useMapsGeneral; aqui fica só o layout flutuante.
import { Pressable, View } from 'react-native'
import { useNavigate, useLocation } from 'react-router-dom'
import { MapAttribution } from '@/components/MapAttribution'
import {
  HeaderUserInfo,
  Icon,
  Logo,
  MapControl,
  SideMenu,
  elevation,
  useTheme,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { useMyVitals } from '@/hooks/useMyVitals'
import workerA from '@/assets/avatars/worker-a.png'
import { useMapsGeneral } from './hooks/useMapsGeneral'
import { HeatmapLegend } from './components/HeatmapLegend'
import { BackToDashboardButton } from './components/BackToDashboardButton'

export function MapsGeneral() {
  const { user } = useAuth()
  const myVitals = useMyVitals()
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const {
    containerRef,
    navItems,
    showOperators,
    setShowOperators,
    showHeatmap,
    setShowHeatmap,
    heatmapOptions,
    setHeatmapOptions,
    showCameras,
    setShowCameras,
    isLocating,
    handleLocate,
    backBtnPanResponder,
    backBtnAnchor,
  } = useMapsGeneral()

  return (
    <View
      testID="maps-general"
      style={{
        // Full viewport — Maps lives OUTSIDE AppLayout (no parent gives size).
        // position:fixed + inset:0 anchors the root to the viewport directly,
        // avoiding the '100vh' string-on-style problem (RNW drops it → auto height
        // → maplibregl canvas grows past viewport → V scrollbar reserves 15px →
        // visible right-side gap). overflow:hidden clamps any rogue child.
        position: 'fixed' as 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.background,
        overflow: 'hidden',
      }}
    >
      {/* Map full-bleed (z-0) */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />

      {/* Mandatory ESRI attribution (bottom-right, non-interactive). */}
      <MapAttribution />

      {/* Top scrim — reproduces the dark fade baked into the mockup
          satellite image (imgMapViewGeneral, node 32:2488). Real ESRI tiles
          lack this built-in contrast, so the Logo + HeaderUserInfo would
          float over bright urban imagery without legibility. pointer-events:
          none keeps the map draggable underneath; z-index 1 sits between map
          and header (z-2). */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 120,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      <HeatmapLegend
        visible={showHeatmap && (heatmapOptions.produtividade || heatmapOptions.zonasAlerta)}
      />

      {/* Header — Logo left + HeaderUserInfo right */}
      <View
        testID="maps-header"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: theme.padding.xxl,
          paddingVertical: theme.padding.sm,
          zIndex: 2,
        }}
      >
        <Logo type="complete" size="m" />
        <HeaderUserInfo
          bpm={myVitals.bpm}
          pressure={myVitals.pressure}
          progress={myVitals.progress}
          avatarUri={user?.avatarUri ?? workerA}
          heartIconName="heart_filled"
          pressureIconName="vitals_pulse"
          borderColor={theme.background}
          testID="maps-header-user-info"
        />
      </View>

      {/* Compact SideMenu — outer at left:24 + inner left:14 = absolute left:38 */}
      <View
        testID="maps-side-menu"
        style={{
          position: 'absolute',
          left: 38,
          top: 162,
          width: 60,
          zIndex: 2,
        }}
      >
        <SideMenu
          items={navItems}
          value={location.pathname}
          variant="minimal"
          iconSize={20}
          badgePosition="outside-left"
          onChange={(v: string) => navigate(v)}
          fullWidth
          accessibilityLabel="Navegação principal"
        />
      </View>

      {/* Map controls — right. The spec calls for right:16 but we use
          right:56 so the 48px-wide control icons (x range vp-104..vp-56) stay
          clear of the heatmap intensity bar pinned at right:6 (x range
          vp-22..vp-6). Original right:16 made the bar pass behind the icons
          and visually clip them. top:calc(50%-241)=242 at 966h preserved. */}
      <View
        testID="maps-controls"
        style={{
          position: 'absolute',
          right: 56,
          top: 242,
          gap: theme.gap.s,
          alignItems: 'flex-end',
          zIndex: 2,
        }}
      >
        <MapControl
          variant="operators"
          expanded={showOperators}
          onExpandedChange={setShowOperators}
        />
        <MapControl
          variant="heatmap"
          expanded={showHeatmap}
          onExpandedChange={setShowHeatmap}
          options={[
            { id: 'produtividade', label: 'Produtividade', checked: heatmapOptions.produtividade },
            { id: 'zonas-alerta', label: 'Zonas de alerta', checked: heatmapOptions.zonasAlerta },
          ]}
          onOptionChange={(id, checked) =>
            setHeatmapOptions((prev) =>
              id === 'produtividade'
                ? { ...prev, produtividade: checked }
                : { ...prev, zonasAlerta: checked },
            )
          }
        />
        <MapControl variant="cameras" expanded={showCameras} onExpandedChange={setShowCameras} />
      </View>

      {/* Minha localização — bottom-left round button. Asks the browser for
          the user's actual coordinates (HTML5 navigator.geolocation) and
          flies the map to them. On denial/error, shows a demo toast.
          Position: bottom-left to balance the bottom-right Voltar button. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Centralizar na minha localização"
        disabled={isLocating}
        onPress={handleLocate}
        style={{
          position: 'absolute',
          // Aligned with the SideMenu column above: SideMenu has left: 38
          // and width: 60 (center X = 68). Centering this 48px button on
          // X=68 gives left = 68 - 24 = 44.
          left: 44,
          bottom: 30,
          width: 48,
          height: 48,
          borderRadius: 999,
          backgroundColor: theme.surface.standard,
          alignItems: 'center',
          justifyContent: 'center',
          // location_on is a pin shape (bulb on top + tail at bottom). Geometric
          // center puts the bulb above the visual midline; nudging content down
          // ~3px brings the bulb to the optical center of the round button.
          paddingTop: 6,
          opacity: isLocating ? 0.6 : 1,
          zIndex: 2,
          ...elevation.sm,
        }}
      >
        <Icon name="location_on" size={24} color={theme.content.dark} />
      </Pressable>

      <BackToDashboardButton
        panHandlers={backBtnPanResponder.panHandlers}
        anchor={backBtnAnchor}
        onPress={() => navigate('/')}
      />
    </View>
  )
}
