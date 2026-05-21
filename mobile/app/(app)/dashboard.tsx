import { useEffect, useState, type ReactNode } from 'react';
import { Image as RNImage, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Stop, SvgXml } from 'react-native-svg';
import {
  Avatar,
  Button,
  Icon,
  JourneyTheme,
  Text,
  Title,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system';
import { NavFABs } from '../../components/NavFABs';
import { WeatherAlertModal } from '../../components/modals/WeatherAlertModal';
import {
  ECG_ICON_SVG,
  ELIPSE34_RING_SVG,
  HEART_STATUS_SVG,
  SETTINGS_ICON_SVG,
  SILHOUETTE_BODY_SVG,
} from '../../lib/dashboardKnobSvgs';
import {
  FIRE_ICON_SVG,
  GAUGE_ICON_SVG,
  HEART_ICON_SVG,
} from '../../lib/dashboardStatIcons';
import {
  ARROW_DOWN_TRIANGLE_SVG,
  ARROW_UP_TRIANGLE_SVG,
  WATER_DROP_SVG,
  WIND_SPEED_SVG,
} from '../../lib/alertWeatherSvgs';
import { useUniqueId, useUniqueSvg } from '../../lib/uniqueSvg';

// Decorative bottom SVG (Figma 304:2430 'background-element') — vertical
// linear gradient from #3BC958 (top) to #1E652C (bottom), 46% opacity.
// Hex codes are brand-specific Figma values; DS palette doesn't ship
// equivalents (audit nit cleanup 2026-05-17 — named here for greppability).
const BG_DECOR_GRAD_TOP = '#3BC958';
const BG_DECOR_GRAD_BOTTOM = '#1E652C';

// Alert state (?alert=modal) — gradient red invertido pra indicar emergência.
// Top/bottom hex extraídos da Screenshot 85 (user reference). Mesmo opacity
// 46% do estado normal.
const BG_DECOR_GRAD_TOP_ALERT = '#E04848';
const BG_DECOR_GRAD_BOTTOM_ALERT = '#5E1818';

// Vertical divider gradient stops (Figma 295:1585 / 304:2455) — fades
// from dark (#171717, matching theme.background) to brand green
// (#62BB81, close to theme.content.primary) and back. Kept as literals
// because the gradient midpoint requires the exact Figma stops.
const DIVIDER_GRAD_END = '#171717';
const DIVIDER_GRAD_MID = '#62BB81';

const BG_DECOR_PATH =
  'M157.378 347.935H64.0356C57.6845 347.935 52.0472 346.719 47.2773 344.319C43.4537 342.394 40.1798 339.711 37.5464 336.344C35.2057 333.35 33.8158 330.358 33.0606 328.376C32.2419 326.222 31.9795 324.789 31.9687 324.73L31.9621 324.692V324.654C31.9676 321.759 32.5411 34.8651 31.9621 16.3288C31.8434 12.5266 30.3809 9.36409 27.6136 6.92631C23.1094 2.95899 15.8801 1.5623 10.6078 1.08815C4.86064 0.5719 0.126303 1.01253 0.0786841 1.01662L0 0.183997C0.0474149 0.178683 4.84653 -0.269714 10.6683 0.253076C14.0947 0.560046 17.2042 1.13761 19.9099 1.96941C23.3156 3.01622 26.0927 4.47218 28.1654 6.29765C31.1144 8.89321 32.6729 12.2601 32.7992 16.3018C33.3762 34.7895 32.809 319.802 32.7992 324.616C32.8446 324.847 33.1266 326.2 33.8567 328.112C34.5924 330.041 35.949 332.95 38.229 335.858C42.2505 340.986 49.9918 347.099 64.0356 347.099H177.508H295.964C310.008 347.099 317.749 340.986 321.77 335.858C324.051 332.95 325.407 330.041 326.143 328.112C326.873 326.2 327.155 324.847 327.201 324.616C327.19 319.802 326.623 34.7895 327.201 16.3018C327.327 12.2601 328.886 8.89321 331.833 6.29765C333.906 4.47218 336.684 3.01622 340.089 1.96941C342.796 1.13761 345.905 0.560046 349.332 0.253076C355.153 -0.269714 359.953 0.178683 360 0.183997L359.92 1.01662C359.873 1.01253 355.138 0.5719 349.391 1.08815C344.119 1.5623 336.89 2.95899 332.386 6.92631C329.619 9.36409 328.156 12.5266 328.037 16.3288C327.458 34.8651 328.031 321.759 328.038 324.654V324.692L328.03 324.73C328.019 324.789 327.758 326.222 326.938 328.376C326.184 330.358 324.794 333.35 322.452 336.344C319.819 339.711 316.545 342.394 312.721 344.319C307.953 346.719 302.314 347.935 295.964 347.935H157.378Z';
const BG_DECOR_W = 360;
const BG_DECOR_H = 347.935;

// Resolve local PNG to a Metro-served URI so DS Avatar (which only accepts
// `uri: string`) can render the asset. TODO: bump DS Avatar to accept
// `source: ImageSourcePropType` to remove this workaround.
const avatarUri =
  Asset.fromModule(require('../../assets/avatar-construction.png')).uri;

// FASE 1 — Layout esqueleto. Placeholders coloridos no lugar dos componentes
// complexos. Próximas fases preenchem: StatusChart (2), main actions (3),
// stats (4), fatigue (5), bottom actions (6), polish (7).
//
// Coordenadas-chave do Figma 245:23280 (viewport 360x≈800):
//   - StatusChart: 0,0 → 360x374 (zona top)
//   - Avatar: right 24, top 34, size 64
//   - Container: left 48, top 271, w 266, gap.xl 28, items-end
//     │ overlap com chart de 103px (374 - 271)
const CHART_ZONE_HEIGHT = 374;
const CONTAINER_TOP = 271;
const CONTAINER_LEFT = 48;
const CONTAINER_WIDTH = 266;
// Figma spec is gap.xl=28, but the DS Button DS renders shape="pill" buttons
// ~4px taller than the Figma 56 spec (60h measured) — accumulating ~11px of
// extra height across the 5 container items. Reducing the gap to 24 absorbs
// that overflow so the bottom action row sits within the frame curve as the
// Figma layout shows (was: bell button touching the BG_DECOR bottom edge).
const CONTAINER_GAP_XL = 24;
const AVATAR_TOP = 34;
const AVATAR_RIGHT = 24;

export default function Dashboard() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // SVGs com <defs> precisam de IDs únicos por instância — caso contrário
  // colidem com cópias renderizadas em outras telas montadas em background.
  const silhouetteXml = useUniqueSvg(SILHOUETTE_BODY_SVG);
  // Second silhouette instance with its own gradient namespace — rendered on
  // top with mix-blend-mode: multiply to match Figma's Caminho 4123 overlay
  // (deeper/richer green than the single-layer gradient).
  const silhouetteMultiplyXml = useUniqueSvg(SILHOUETTE_BODY_SVG);
  const elipse34Xml = useUniqueSvg(ELIPSE34_RING_SVG);
  const gaugeXml = useUniqueSvg(GAUGE_ICON_SVG);
  const bgDecorGradId = useUniqueId('bg-decor-grad');
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  // Letterbox fit: scale uniforme que mantém o canvas 360×800 inteiro dentro
  // da safe area. Pega o menor entre width-fit e height-fit pra nunca clipar
  // nem horizontal nem vertical. Sobra (canvas menor que safe area) vira
  // barras letterbox em theme.background. Phase 1 — fidelity-letterbox plan.
  const safeHeight = viewportHeight - insets.top - insets.bottom;
  const canvasScale = Math.min(viewportWidth / 360, safeHeight / 800);
  // Demo-only: camera starts on; tapping the camera button toggles the
  // green status dot. Production wiring would mirror live worker state.
  const [cameraActive, setCameraActive] = useState(true);

  // Dashboard tem 3 estados:
  // - sem param: normal (silhouette verde + stats).
  // - ?alert=modal (Figma 385:29138 + 385:29371): dashboard com bg/silhueta
  //   em RED (`surface.danger` tint), e modal "Local em Alerta!" aparece
  //   sobreposto após 800ms com dissolve animation (Figma interaction spec).
  // - ?alert=active (Figma 385:29591): painel "Procedimento de evacuação"
  //   com timeline cyan + botão "Traçar rota" verde.
  const { alert } = useLocalSearchParams<{ alert?: string }>();
  const isAlertModal = alert === 'modal';
  // Modal opens 800ms após mount, com dissolve fade-in 240ms ease-in-out
  // (Figma interaction spec: After delay 800ms → Open overlay alert-modal,
  // Animate Dissolve, Easing Ease in and out, Duration 240ms).
  const [modalVisible, setModalVisible] = useState(false);
  useEffect(() => {
    if (!isAlertModal) {
      setModalVisible(false);
      return;
    }
    const t = setTimeout(() => setModalVisible(true), 800);
    return () => clearTimeout(t);
  }, [isAlertModal]);

  if (alert === 'active') {
    return <AlertActiveView />;
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* A2 — Bottom decoration (Figma 304:2430 background-element). Sibling
          do canvas wrapper (não filho): estica full-viewport pra moldura verde
          tocar a borda da tela em qualquer iPhone. preserveAspectRatio="none"
          permite stretch horizontal não-uniforme. Ver Gap J Phase 2. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: 20.06,
          left: 0,
          right: 0,
          height: BG_DECOR_H,
          alignItems: 'center',
        }}
      >
        <Svg
          width="100%"
          height={BG_DECOR_H}
          viewBox={`0 0 ${BG_DECOR_W} ${BG_DECOR_H}`}
          preserveAspectRatio="none"
        >
          <Defs>
            <LinearGradient
              id={bgDecorGradId}
              x1="180"
              y1="0"
              x2="180"
              y2={BG_DECOR_H}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={isAlertModal ? BG_DECOR_GRAD_TOP_ALERT : BG_DECOR_GRAD_TOP} />
              <Stop offset="1" stopColor={isAlertModal ? BG_DECOR_GRAD_BOTTOM_ALERT : BG_DECOR_GRAD_BOTTOM} />
            </LinearGradient>
          </Defs>
          <Path d={BG_DECOR_PATH} fill={`url(#${bgDecorGradId})`} opacity={0.46} />
        </Svg>
      </View>

      {/* Canvas wrapper — 360-wide com transform: scale pra ocupar viewport
          inteira mantendo proporções Figma 360x800. Em iPhone 390 scale ~1.083.
          Gap I + Gap J. */}
      <View
        style={{
          width: 360,
          height: 800,
          transform: [{ scale: canvasScale }],
          transformOrigin: 'center center',
        }}
      >
        {/* Canvas BG: gradient compartilhado com BGJourney (asset
            byte-identical) + dot-grid (Figma 1069:11271, layer 3 do
            JourneyTheme). Sem `pattern` — dashboard não usa a malha
            tracejada do smartband. */}
        <JourneyTheme gradient={require('../../assets/journey-bg.png')} />

      {/* Top zone — Knob ("grupo taigo novo" 1069:11605) as background, then
          silhouette (I304:2357;295:1931), heart status (I304:2357;295:2180),
          heart-rate button → my-stats (I304:2357;304:2585), settings gear
          sub-badge (I304:2357;304:2598), and avatar overlaid in the corner.
          Coordinates are absolute from the Figma frame (360×374 chart zone),
          mirroring the StatusChart layout that we replaced. */}
      <View style={{ height: CHART_ZONE_HEIGHT }}>
        {/* 1. Knob bezel — decorative, behind everything */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <RNImage
            source={require('../../assets/grupo-taigo.png')}
            resizeMode="contain"
            style={{ width: 298, height: 298 }}
            accessible={false}
          />
        </View>

        {/* 2. Silhouette body — Figma left calc(50%+0.39) means center+0.39px;
             positioned absolute with the same width and the explicit left so
             RN-web doesn't need transform math. Two stacked layers: base
             gradient + multiply overlay (matches Figma Caminho 4081 + 4123). */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 87.47,
            left: 141.906,
            width: 76.967,
            height: 262.318,
          }}
        >
          <SvgXml xml={silhouetteXml} width="100%" height="100%" />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 87.47,
            left: 141.906,
            width: 76.967,
            height: 262.318,
            // @ts-expect-error: mixBlendMode is web-only style (RN-web).
            // Falls back to single-layer silhouette on native — slightly
            // less saturated but still readable.
            mixBlendMode: 'multiply',
          }}
        >
          <SvgXml xml={silhouetteMultiplyXml} width="100%" height="100%" />
        </View>

        {/* 3. Heart status badge (chest area). Figma Heart Status group
             (I304:2357;295:2180) is 31.311×26.093 — white heart bottom-left
             + green check-circle top-right. SVG composite now includes both. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 139.327,
            left: 169.2,
            width: 31.311,
            height: 26.093,
          }}
        >
          <SvgXml xml={HEART_STATUS_SVG} width="100%" height="100%" />
        </View>

        {/* 4. Heart-rate button → /my-stats. Smart-animate expand transition
             (320ms ease-in-out) is the target — for now it's a plain push,
             shared transitions are a follow-up. */}
        <Pressable
          onPress={() => router.push('/(app)/my-stats')}
          accessibilityRole="button"
          accessibilityLabel="Abrir minhas estatísticas"
          style={{
            position: 'absolute',
            // Figma 1069:11336 spec top is 187.04, but in app the silhouette
            // renders taller proportionally; lifted to 157 to keep the button
            // visually at chest-level of the silhouette (matches Figma look
            // even though absolute coords differ).
            top: 157,
            right: 22.45,
            width: 90.03,
            height: 90.03,
            borderRadius: 45.015,
            backgroundColor: theme.surface.high,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000000',
            shadowOpacity: 0.1608,
            shadowOffset: { width: 0, height: 2.18 },
            shadowRadius: 4.36,
            elevation: 4,
          }}
        >
          {/* Inner well Figma 1069:11337 "Elipse 34" — círculo r=34.49 com
              filtros SVG (drop + inner shadow próprios). Cria o anel
              concêntrico recessed onde o ECG senta. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: (90.03 - 77.687) / 2,
              left: (90.03 - 77.687) / 2,
              width: 77.687,
              height: 77.687,
            }}
          >
            <SvgXml xml={elipse34Xml} width="100%" height="100%" />
          </View>
          {/* ECG wrappeado em View absolute pra entrar no mesmo paint pass
              da Elipse 34 — caso contrário CSS pinta absolutos depois de
              estáticos e a Elipse34 cobre o ECG. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: (90.03 - 32.855) / 2,
              left: (90.03 - 36.027) / 2,
              width: 36.027,
              height: 32.855,
            }}
          >
            <SvgXml xml={ECG_ICON_SVG} width="100%" height="100%" />
          </View>

          {/* Settings gear sub-badge — Figma 304:2598. Top-right corner of
              the heart-rate button. Padding 3.924, content 23.544 → total ~31.
              Stops propagation so the parent ECG tap doesn't fire. */}
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              router.push('/(app)/settings');
            }}
            accessibilityRole="button"
            accessibilityLabel="Abrir configurações"
            hitSlop={6}
            style={{
              position: 'absolute',
              top: 0,
              right: -0.22,
              padding: 3.924,
              borderRadius: 980,
              backgroundColor: theme.surface.medium,
              shadowColor: '#000000',
              shadowOpacity: 0.1608,
              shadowOffset: { width: 0, height: 2.18 },
              shadowRadius: 4.36,
              elevation: 2,
              // @ts-expect-error: inset boxShadow is web-only (RN-web)
              boxShadow:
                'inset 0px 2.18px 4.36px 0px rgba(0,0,0,0.5882), 0px 2.18px 4.36px 0px rgba(0,0,0,0.1608)',
            }}
          >
            <SvgXml
              xml={SETTINGS_ICON_SVG}
              width={23.544}
              height={23.544}
            />
          </Pressable>
        </Pressable>

        {/* 5. Avatar — absolute top-right, overlays the chart.
            Pressable wraps the avatar so tapping it opens /(app)/settings.
            Before R-4 (2026-05-17), settings was unreachable from the (app)
            graph — avatar is the canonical iOS/Android profile-entry idiom. */}
        <Pressable
          onPress={() => router.push('/(app)/settings')}
          accessibilityRole="button"
          accessibilityLabel="Abrir configurações"
          hitSlop={8}
          style={{ position: 'absolute', top: AVATAR_TOP, right: AVATAR_RIGHT }}
        >
          <Avatar
            customSize={64}
            uri={avatarUri}
            bordered
            borderWidth={4}
            borderColor={theme.content.dark}
            fallbackBackgroundColor={theme.surface.medium}
          />
        </Pressable>
      </View>

      {/* Container — Figma left=48 top=271 w=266 items-end. Overlap 103px into chart. */}
      <View
        style={{
          marginTop: CONTAINER_TOP - CHART_ZONE_HEIGHT,
          paddingLeft: CONTAINER_LEFT,
          width: CONTAINER_LEFT + CONTAINER_WIDTH,
          gap: CONTAINER_GAP_XL,
          alignItems: 'flex-end',
        }}
      >
        {/* 1. Location button — pill icon-only, contained primary, right-aligned.
            marginTop -30 lifts it visually closer to the heart-rate button
            above (to match the Figma proportions which show both buttons
            tighter together near the silhouette's chest-hip area). */}
        <View style={{ alignSelf: 'flex-end', marginTop: -30 }}>
          <Button
            variant="contained"
            size="large"
            shape="pill"
            elevation="lg"
            iconLeft={
              <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                <Icon
                  name="location_pin"
                  width={16}
                  height={20}
                  color={theme.content.light}
                />
              </View>
            }
            accessibilityLabel="Localização"
            onPress={() => router.push('/(app)/map')}
          />
        </View>

        {/* 2. Main actions row: Camera (outline content.dark 1px) + Work (outline content.primary 2px) */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
          {/* Camera with live-status dot — Figma 304:2683 + ellipse 304:2682 */}
          <View>
            <Button
              variant="outline"
              size="large"
              shape="pill"
              borderColor={theme.content.dark}
              borderWidth="s"
              iconLeft={
                <Icon
                  name="video_camera_back"
                  width={20}
                  height={16}
                  color={theme.content.dark}
                />
              }
              accessibilityLabel={`Câmera ${cameraActive ? 'ativa' : 'inativa'}`}
              onPress={() => setCameraActive((on) => !on)}
            />
            {cameraActive ? (
              <View
                accessibilityLabel="Câmera ativa"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: 20,
                  height: 20,
                  borderRadius: theme.border.radius.pill,
                  backgroundColor: theme.surface.success,
                  borderWidth: 2,
                  borderColor: theme.background,
                }}
              />
            ) : null}
          </View>
          <Button
            variant="outline"
            size="large"
            shape="pill"
            borderColor={theme.content.primary}
            borderWidth="m"
            iconLeft={
              <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                <Icon
                  name="business_center_filled"
                  width={20}
                  height={19}
                  color={theme.content.primary}
                />
              </View>
            }
            accessibilityLabel="Trabalho"
            onPress={() => router.push('/(app)/journey')}
          />
        </View>

        {/* 3. User stats: 3 cols + dividers (Figma 304:2458) */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          <StatCol
            iconNode={
              <SvgXml
                xml={HEART_ICON_SVG}
                width={20}
                height={18.35}
                color={theme.content.primary}
              />
            }
            value="67"
            label="BPM"
            width={41}
            theme={theme}
          />
          <Divider theme={theme} />
          <StatCol
            iconNode={
              <SvgXml
                xml={gaugeXml}
                width={20}
                height={20}
                color={theme.content.primary}
              />
            }
            value="12/8"
            label="Boa"
            width={65}
            theme={theme}
          />
          <Divider theme={theme} />
          <StatCol
            iconNode={
              <SvgXml
                xml={FIRE_ICON_SVG}
                width={16.384}
                height={22}
                color={theme.content.primary}
              />
            }
            value="145"
            label="Kcal/hora"
            width={55}
            theme={theme}
          />
        </View>

        {/* 4. Fatigue progress — Figma 304:2433. DS v0.1.32+ bordered prop
            renders the 22px-tall pill frame natively; gradient direction
            rtl + custom stops [43.75, 79.253, 100] match the Figma fill
            (red on the left → green on the right). Fill value 74 mirrors
            the Figma snapshot (pr-76 on a 328-wide track) — original 74.4
            triggered Fabric HostFunction precision error in DS v0.1.34
            ProgressBar (accessibilityValue.now expects int64; see Gap H). */}
        <View style={{ gap: theme.gap.s, width: '100%' }}>
          <FatigueBar
            value={74}
            gradient={[
              theme.surface.success,
              theme.surface.warning,
              theme.surface.error,
            ]}
            gradientStops={[43.75, 79.253, 100]}
            theme={theme}
          />
          <Text variant="body.m" color={theme.content.dark}>
            Tempo até atingir fadiga total: 1h45m
          </Text>
        </View>

        {/* 5. Bottom actions row: reports + notif (with badge "4") + chat + help */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 41, width: '100%' }}>
          <View style={{ gap: theme.gap.s }}>
            <BadgedButton
              icon="reports_filled"
              badge="4"
              accessibilityLabel="Relatórios — 4 não lidos"
              onPress={() => router.push('/(app)/reports')}
              theme={theme}
            />
            <BadgedButton
              icon="notifications"
              badge="4"
              accessibilityLabel="Notificações — 4 não lidas"
              onPress={() => router.push('/(app)/notifications')}
              theme={theme}
            />
          </View>
          <Button
            variant="contained"
            size="xlarge"
            shape="pill"
            elevation="lg"
            backgroundColor={theme.surface.success}
            iconLeft={<Icon name="chat_bubble" size={26} color={theme.content.dark} />}
            accessibilityLabel="Chat"
            onPress={() => router.push('/(app)/chat/inbox')}
          />
          <Button
            variant="contained"
            size="large"
            shape="pill"
            elevation="lg"
            backgroundColor={theme.surface.danger}
            iconLeft={
              <Icon
                name="hand"
                width={18}
                height={22}
                color={theme.content.dark}
              />
            }
            accessibilityLabel="Ajuda urgente"
            onPress={() => router.replace('/(app)/dashboard?alert=modal')}
          />
        </View>
      </View>
      </View>

      {/* Alert modal overlay (Figma 385:29371 alert-modal) — renderiza
          inline quando ?alert=modal, com delay 800ms + dissolve fade-in
          240ms ease-in-out. CTA navega pra ?alert=active (timeline). */}
      {isAlertModal ? (
        <View
          pointerEvents={modalVisible ? 'auto' : 'none'}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.padding.m,
            backgroundColor: 'rgba(0,0,0,0.4)',
            opacity: modalVisible ? 1 : 0,
            // @ts-expect-error: transition is web-only style (RN-web).
            transition: 'opacity 240ms ease-in-out',
            zIndex: 10,
          }}
        >
          <WeatherAlertModal
            onClose={() => router.replace('/(app)/dashboard')}
            onPrimaryAction={() => router.replace('/(app)/dashboard?alert=active')}
          />
        </View>
      ) : null}
    </View>
  );
}

// --- Placeholders locais (compõem DS primitives, não substituem nada do DS) ---

function StatCol({
  iconNode,
  label,
  value,
  width,
  theme,
}: {
  iconNode: ReactNode;
  label: string;
  value: string;
  width: number;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={{ alignItems: 'center', gap: theme.gap.sm, width }}>
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        {iconNode}
      </View>
      <Title variant="title.l" color={theme.content.dark}>
        {value}
      </Title>
      <Text variant="body.s" color={theme.content.dark}>
        {label}
      </Text>
    </View>
  );
}

// FatigueBar — local replacement for DS ProgressBar. The DS component has
// `id="pb-gradient"` hardcoded in its <Defs>, which collides across multiple
// dashboard instances (Stack keeps screens mounted) and breaks the visible
// fill. Mirrors the bordered + gradient layout but with useUniqueId.
function FatigueBar({
  value,
  gradient,
  gradientStops,
  theme: barTheme,
}: {
  value: number;
  gradient: [string, string, string];
  gradientStops: [number, number, number];
  theme: ReturnType<typeof useTheme>;
}) {
  const gradId = useUniqueId('pb-gradient');
  const FILL_HEIGHT = 6;
  const trackHeight = 22;
  const innerPad = (trackHeight - FILL_HEIGHT) / 2;
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Tempo até atingir fadiga total"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{
        height: trackHeight,
        alignSelf: 'stretch',
        borderRadius: barTheme.border.radius.pill,
        borderWidth: 1,
        borderColor: barTheme.content.medium,
        backgroundColor: barTheme.background,
        paddingHorizontal: innerPad,
        paddingVertical: innerPad,
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <View style={{ width: `${pct}%`, height: FILL_HEIGHT, overflow: 'hidden' }}>
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 100 ${FILL_HEIGHT}`}
          preserveAspectRatio="none"
        >
          <Defs>
            <LinearGradient
              id={gradId}
              x1={100}
              y1="0"
              x2={0}
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset={`${gradientStops[0]}%`} stopColor={gradient[0]} />
              <Stop offset={`${gradientStops[1]}%`} stopColor={gradient[1]} />
              <Stop offset={`${gradientStops[2]}%`} stopColor={gradient[2]} />
            </LinearGradient>
          </Defs>
          <Path
            d={`M0 0 H100 V${FILL_HEIGHT} H0 Z`}
            fill={`url(#${gradId})`}
          />
        </Svg>
      </View>
    </View>
  );
}

// Divider — vertical SVG with linear gradient (Figma 295:1585 / 304:2455):
// fades #171717 → #62BB81 (midpoint) → #171717 over 106px tall, 1px wide.
function Divider({ theme: _theme }: { theme: ReturnType<typeof useTheme> }) {
  const gradId = useUniqueId('divider-grad');
  return (
    <Svg width={1} height={106} viewBox="0 0 1 106">
      <Defs>
        <LinearGradient
          id={gradId}
          x1="0.5"
          y1="0"
          x2="0.5"
          y2="106"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor={DIVIDER_GRAD_END} />
          <Stop offset="0.506" stopColor={DIVIDER_GRAD_MID} />
          <Stop offset="1" stopColor={DIVIDER_GRAD_END} />
        </LinearGradient>
      </Defs>
      <Path d="M1 106H0V0H1V106Z" fill={`url(#${gradId})`} />
    </Svg>
  );
}

function BadgedButton({
  icon,
  badge,
  accessibilityLabel,
  onPress,
  theme,
}: {
  icon: IconName;
  badge?: string;
  accessibilityLabel: string;
  onPress?: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  // 56×56 wrapper per Figma 304:2683 / 304:2725. Badge sits at top-right of
  // wrapper (overlapping the button's upper-right quadrant), not floating
  // outside it.
  return (
    <View style={{ width: 56, height: 56 }}>
      <Button
        variant="outline"
        size="large"
        shape="pill"
        borderColor={theme.content.dark}
        borderWidth="s"
        iconLeft={<Icon name={icon} size={24} color={theme.content.dark} />}
        accessibilityLabel={accessibilityLabel}
        onPress={onPress ?? (() => {})}
      />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 24,
            height: 24,
            borderRadius: theme.border.radius.pill,
            backgroundColor: theme.surface.error,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="caption.s" color={theme.content.light}>
            {badge}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// --- Alert-active view (Figma 385:29591 dashboard-alert-active) ---
// Anteriormente vivia em `app/(app)/alert-instructions.tsx`. Por decisão
// 2026-05-15, dashboard e alert-instructions são o mesmo screen com 2
// estados; este componente serve o branch `?alert=active`.
function AlertActiveView() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Bolinhas da timeline (Figma 385:29807 etc.) usam `surface/secondary`
  // #50B3D2 (teal escuro). A linha vertical entre bolinhas usa um cyan
  // mais claro `content/secondary` #8AD2E2 — cores DIFERENTES por design.
  const stepCircle = (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: theme.surface.secondary,
        marginTop: 2,
      }}
    />
  );

  // Cada item exceto o último ganha um segmento de linha que vai do
  // centro da bolinha até o final do item, conectando com o próximo
  // segmento na próxima bolinha. Isso garante que a linha SEMPRE termine
  // no centro da última bolinha (independente da altura dos items).
  // `top: 12` = bolinha marginTop(2) + raio(10) → centro vertical.
  const lineSegment = (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 9,
        top: 12,
        bottom: -theme.gap.m,
        width: 1,
        backgroundColor: theme.content.secondary,
      }}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Dot-grid (Figma 385:29751 "Repetição de grade 4") — 27 colunas,
          opacity 9%, centrado no topo. Mesma camada do dashboard/my-stats. */}
      <JourneyTheme />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.padding.m,
          paddingBottom: insets.bottom + 160,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.l,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <View style={{ alignItems: 'center' }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Procedimento de evacuação
          </Title>
        </View>

        {/* Weather row */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.gap.m,
          }}
        >
          {/* Left: condition card (Figma 385:30119). Fixed 203×100. Content
              alinha bottom (justify-end) pra deixar espaço pro ícone de chuva
              transbordar o topo do card. Padding só horizontal+bottom — top
              fica zero pra não empurrar texto pra baixo do ícone. */}
          <View
            style={{
              width: 203,
              height: 100,
              backgroundColor: theme.surface.high,
              borderRadius: theme.border.radius.m,
              paddingHorizontal: theme.padding.s,
              paddingBottom: theme.padding.s,
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: theme.gap.s,
            }}
          >
            {/* Ícone de chuva (Figma 385:30122) — 72×72.76 posicionado
                top:-28.38 (transborda o topo do card, ~40% fica fora). DS
                WeatherIcon 404 com asset path em node_modules; renderiza
                direto via RNImage do mobile/assets/. */}
            <View
              style={{
                position: 'absolute',
                top: -28,
                alignSelf: 'center',
                zIndex: 2,
              }}
              pointerEvents="none"
            >
              <RNImage
                source={require('../../assets/weather-rainy.png')}
                style={{ width: 72, height: 72 }}
                resizeMode="contain"
                accessibilityLabel="Chuva intensa"
              />
            </View>
            <Title variant="title.l" color={theme.content.dark}>
              17ºC
            </Title>
            <Text variant="body.m" color={theme.content.dark}>
              Chuva Intensa
            </Text>
          </View>

          {/* Right: data column (Figma 385:30123). Width fixa 83px. Os
              4 ícones vêm dos SVGs do Figma (alertWeatherSvgs) porque
              os equivalentes do DS têm shapes diferentes. */}
          <View style={{ width: 83, gap: theme.gap.s }}>
            <WeatherDataRow svg={WATER_DROP_SVG} svgW={14} svgH={20} value="65%" theme={theme} />
            <WeatherDataRow svg={WIND_SPEED_SVG} svgW={20} svgH={17} value="65km/h" theme={theme} />
            <WeatherDataRow svg={ARROW_UP_TRIANGLE_SVG} svgW={22} svgH={19} value="32ºC" theme={theme} />
            <WeatherDataRow svg={ARROW_DOWN_TRIANGLE_SVG} svgW={22} svgH={19} value="19ºC" theme={theme} />
          </View>
        </View>

        {/* Description */}
        <Text
          variant="body.s"
          color={theme.content.dark}
          style={{ textAlign: 'center' }}
        >
          Risco de desabamentos nas primeiras horas do dia, procure a rota de
          siga as instruções para a evacuação.
        </Text>

        {/* Instructions list */}
        <View style={{ gap: theme.gap.m }}>
          {/* Step 1 — Traçar rota */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            {lineSegment}
            <View style={{ flex: 1, gap: 8, alignItems: 'flex-start' }}>
              <Text variant="body.m" color={theme.content.dark}>
                Desloque-se para o local de resgate
              </Text>
              <Button
                variant="contained"
                size="small"
                backgroundColor={theme.surface.primary}
                labelColor={theme.content.light}
                label="Traçar rota"
                iconRight={
                  <Icon
                    name="location_pin"
                    width={16}
                    height={20}
                    color={theme.content.light}
                  />
                }
                elevation="lg"
                accessibilityLabel="Traçar rota de evacuação"
                onPress={() => router.push('/(app)/evacuation')}
              />
            </View>
          </View>

          {/* Step 2 — Mantenha-se em abrigo */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            {lineSegment}
            <Text
              variant="body.m"
              color={theme.content.dark}
              style={{ flex: 1 }}
            >
              Mantenha se em um abrigo protegido do vento
            </Text>
          </View>

          {/* Step 3 — Espere pelo veículo + chip */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            {lineSegment}
            <View style={{ flex: 1, gap: 8, alignItems: 'flex-start' }}>
              <Text variant="body.m" color={theme.content.dark}>
                Espere pelo veículo de resgate
              </Text>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.content.primary,
                  borderRadius: theme.border.radius.m,
                  paddingHorizontal: theme.padding.sm,
                  paddingVertical: theme.padding.xs,
                }}
              >
                <Text variant="body.s" color={theme.content.primary}>
                  Aprox. 7 minutos
                </Text>
              </View>
            </View>
          </View>

          {/* Step 4 — Reportar acidente (último item, sem lineSegment). */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            <View style={{ flex: 1, gap: 12, alignItems: 'flex-start' }}>
              <Text variant="body.m" color={theme.content.dark}>
                Se você ou alguém estiver ferido, reporte imediatamente à central
              </Text>
              <Button
                variant="contained"
                size="small"
                backgroundColor={theme.surface.accent}
                labelColor={theme.content.light}
                label="Reportar acidente"
                elevation="lg"
                accessibilityLabel="Reportar acidente"
                onPress={() => router.push('/(app)/reports/new')}
              />
            </View>
          </View>
        </View>

        {/* Confirmation block */}
        <View style={{ gap: 15 }}>
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ textAlign: 'center' }}
          >
            Mantenha-se calmo. Estamos à caminho.
          </Text>
          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Entendi, estou seguindo as instruções"
            fullWidth
            elevation="lg"
            accessibilityLabel="Confirmar instruções recebidas"
            onPress={() => router.replace('/(app)/dashboard')}
          />
        </View>
      </ScrollView>

      <NavFABs />
    </View>
  );
}

function WeatherDataRow({
  theme,
  svg,
  svgW,
  svgH,
  value,
}: {
  theme: ReturnType<typeof useTheme>;
  svg: string;
  svgW: number;
  svgH: number;
  value: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.gap.s,
      }}
    >
      {/* Container 24x24 igual aos antigos ícones do DS pra manter
          alinhamento vertical entre as 4 rows; ícone fica centralizado
          dentro mas usa seu tamanho intrínseco do Figma. */}
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        <SvgXml xml={svg} width={svgW} height={svgH} />
      </View>
      <Text variant="body.m" color={theme.content.dark}>
        {value}
      </Text>
    </View>
  );
}
