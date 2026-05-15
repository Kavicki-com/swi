// src/pages/alerts/AlertsRescueRoute.tsx
// /alerts/:employeeId/rescue/:rescuerId — Figma 101:7936. Static basemap
// (Figma reference, Diamantina region) + 2 absolute-positioned pins + a
// solid SVG path connecting them + time/distance labels along the route +
// a centered confirmation modal (Figma 101:8167). "Continuar" dismisses
// the modal; the route stays visible.
//
// Why static instead of maplibre: the Figma is pixel-aligned around a
// specific basemap image (highways, town labels). Live tiles would not
// match the reference at any zoom, so we render the exported image and
// place pins/route as overlays positioned in percentage coordinates.
import { useState } from 'react'
import { View } from 'react-native'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  Button,
  Icon,
  LocationPin,
  SwiThemeProvider,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import basemapSrc from '@/assets/maps/alerts-rescue-basemap.jpg'

// Pin positions tuned against the Figma reference (101:7936). Percent
// coordinates so the layout reflows at any container size.
const RESCUER_POS = { left: '34%', top: '52%' } as const
const INJURED_POS = { left: '52%', top: '34%' } as const

// SVG route path — connects the rescuer pin tail tip (340, 364) to the
// injured pin tail tip (520, 238) with a downward bow, mimicking the road
// shape the Figma route follows. Coordinates are in the SVG viewBox
// 0..1000 / 0..700 space (route is rendered as preserveAspectRatio="none").
// Keep these endpoints in sync with RESCUER_POS / INJURED_POS above (xPct*10 / yPct*7).
const ROUTE_PATH_D = 'M 340 364 C 380 450 460 380 520 238'

// Anchors for the inline labels along the route.
const LABEL_6MIN = { left: '38%', top: '54%' } as const
const LABEL_17MIN = { left: '50%', top: '38%' } as const
const LABEL_16KM = { left: '44%', top: '62%' } as const

export function AlertsRescueRoute() {
  const theme = useTheme()
  const { rescuerId } = useParams<{ employeeId?: string; rescuerId?: string }>()
  // Dispatched state is persisted in the URL (`?dispatched=true`) so a
  // refresh of /alerts/:employeeId/rescue/:rescuerId?dispatched=true
  // returns the user to the post-Continuar view (Figma 101:8359
  // alerts-rescue-ongoing). The modal opens on the pre-dispatch view
  // only.
  const [searchParams, setSearchParams] = useSearchParams()
  const dispatched = searchParams.get('dispatched') === 'true'
  const [modalVisible, setModalVisible] = useState(!dispatched)
  const routeStroke = dispatched ? '#8B5CF6' : '#2BA8C9'

  return (
    <View
      testID="alerts-rescue-route"
      accessibilityLabel={`Rescue route ${rescuerId ?? ''}`}
      style={{
        flex: 1,
        position: 'relative',
        borderRadius: theme.border.radius.m,
        overflow: 'hidden',
      }}
    >
      {/* Static basemap. <img> is the simplest way to keep the Figma
          reference 1:1 — react-native-web passes <img> through unchanged. */}
      <img
        src={basemapSrc}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />

      {/* Route line — solid cyan path that passes through the location.
          Drawn in SVG so it sits between the basemap and the pins. */}
      <svg
        viewBox="0 0 1000 700"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <path
          d={ROUTE_PATH_D}
          fill="none"
          stroke={routeStroke}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Inline time/distance labels (Figma 101:7936). White Inter Bold 14. */}
      {(
        [
          { pos: LABEL_6MIN, label: '6 minutos' },
          { pos: LABEL_17MIN, label: '17 minutos' },
          { pos: LABEL_16KM, label: '16 Km' },
        ] as const
      ).map((it) => (
        <View
          key={it.label}
          style={{
            position: 'absolute',
            left: it.pos.left,
            top: it.pos.top,
            transform: [{ translateX: -40 }],
          }}
        >
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{
              fontWeight: '700',
              textShadowColor: 'rgba(0,0,0,0.6)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 2,
            }}
          >
            {it.label}
          </Text>
        </View>
      ))}

      {/* Pins — rescuer (green check) and injured (red error). Anchored
          to the bottom-center of each Pin so the tail sits exactly on the
          target coordinate, matching the Figma reference. Once dispatched,
          the rescuer pin becomes a small violet "moving" marker (no tail). */}
      <View
        style={{
          position: 'absolute',
          left: RESCUER_POS.left,
          top: RESCUER_POS.top,
          transform: dispatched
            ? [{ translateX: -16 }, { translateY: -16 }]
            : [{ translateX: -20 }, { translateY: -54 }],
        }}
      >
        {dispatched ? (
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: theme.border.radius.s,
              backgroundColor: '#8B5CF6',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="directions_walk" size={20} color={theme.content.dark} />
          </View>
        ) : (
          <SwiThemeProvider>
            <LocationPin variant="badge" status="good" />
          </SwiThemeProvider>
        )}
      </View>
      <View
        style={{
          position: 'absolute',
          left: INJURED_POS.left,
          top: INJURED_POS.top,
          transform: [{ translateX: -20 }, { translateY: -54 }],
        }}
      >
        <SwiThemeProvider>
          <LocationPin variant="badge" status="low" />
        </SwiThemeProvider>
      </View>

      {modalVisible ? (
        <View
          style={{
            position: 'absolute',
            top: 80,
            left: '50%',
            transform: [{ translateX: -130 }],
            width: 260,
            backgroundColor: theme.surface.standard,
            borderRadius: theme.border.radius.l,
            padding: theme.padding.m,
            gap: theme.gap.m,
            alignItems: 'center',
          }}
        >
          <Icon name="turn_right" size={24} color={theme.content.dark} />
          <Title
            variant="title.xs"
            color={theme.content.success}
            style={{ textAlign: 'center', width: '100%' }}
          >
            Enviar rota de socorro
          </Title>
          <Text
            variant="body.s"
            color={theme.content.dark}
            style={{ textAlign: 'center', width: '100%' }}
          >
            O colaborador que prestará socorro terá o tempo de trabalho pausado até o resgate
            chegar.
          </Text>
          <View style={{ width: '100%' }}>
            <Button
              label="Continuar"
              backgroundColor={theme.surface.success}
              onPress={() => {
                setModalVisible(false)
                setSearchParams({ dispatched: 'true' }, { replace: true })
              }}
            />
          </View>
        </View>
      ) : null}
    </View>
  )
}
