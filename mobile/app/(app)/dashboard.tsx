import { useState } from 'react';
import { Image as RNImage, useWindowDimensions, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  Avatar,
  Button,
  Icon,
  ProgressBar,
  StatusChart,
  Text,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system';

// Decorative bottom SVG (Figma 304:2430 'background-element') — vertical
// linear gradient from #3BC958 (top) to #1E652C (bottom), 46% opacity.
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
const CONTAINER_GAP_XL = 28;
const AVATAR_TOP = 34;
const AVATAR_RIGHT = 24;

export default function Dashboard() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
              id="bg-decor-grad"
              x1="180"
              y1="0"
              x2="180"
              y2={BG_DECOR_H}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor="#3BC958" />
              <Stop offset="1" stopColor="#1E652C" />
            </LinearGradient>
          </Defs>
          <Path d={BG_DECOR_PATH} fill="url(#bg-decor-grad)" opacity={0.46} />
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
        {/* A1 — Canvas-bound background overlay (Figma 245:23280 imgDashboard).
            Posicionado DENTRO do canvas wrapper (não no root) pra o padrão
            de pontos parar nas bordas do canvas 360×800 — match com Figma
            onde imgDashboard é filho do frame dashboard, não da viewport.
            Resultado: contraste claro entre card do StatusChart (theme.background
            sólido) e canvas (com pontos), revelando cantos arredondados. */}
        <RNImage
          source={require('../../assets/dashboard-bg.png')}
          resizeMode="cover"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />

      {/* Top zone — StatusChart from DS (silhouette + arcs + heart-rate button) */}
      <View style={{ height: CHART_ZONE_HEIGHT }}>
        <StatusChart
          condition="good"
          progress={1}
          onPressHeartRate={() => router.push('/(app)/my-stats')}
        />

        {/* Avatar — absolute top-right, overlays the chart */}
        <View
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
        </View>
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
        {/* 1. Location button — pill icon-only, contained primary, right-aligned */}
        <View style={{ alignSelf: 'flex-end' }}>
          <Button
            variant="contained"
            size="large"
            shape="pill"
            elevation="lg"
            iconLeft={
              <Icon
                name="location_pin"
                width={16}
                height={20}
                color={theme.content.light}
              />
            }
            accessibilityLabel="Localização"
            onPress={() => {}}
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
              <Icon
                name="business_center_filled"
                width={20}
                height={19}
                color={theme.content.dark}
              />
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
            iconName="favorite_filled"
            iconColor={theme.content.primary}
            iconWidth={20}
            iconHeight={18}
            value="67"
            label="BPM"
            width={41}
            theme={theme}
          />
          <Divider theme={theme} />
          <StatCol
            iconName="blood_pressure"
            iconColor={theme.content.primary}
            value="12/8"
            label="Boa"
            width={65}
            theme={theme}
          />
          <Divider theme={theme} />
          <StatCol
            iconName="local_fire_department"
            iconColor={theme.surface.error}
            iconWidth={16}
            iconHeight={22}
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
          <ProgressBar
            value={74}
            bordered
            trackHeight={22}
            gradient={[
              theme.surface.success,
              theme.surface.warning,
              theme.surface.error,
            ]}
            gradientStops={[43.75, 79.253, 100]}
            gradientDirection="rtl"
            accessibilityLabel="Tempo até atingir fadiga total"
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
              theme={theme}
            />
          </View>
          <Button
            variant="contained"
            size="xlarge"
            shape="pill"
            elevation="lg"
            backgroundColor={theme.surface.success}
            iconLeft={<Icon name="chat_bubble" size={26} color={theme.content.light} />}
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
            onPress={() => {}}
          />
        </View>
      </View>
      </View>
    </View>
  );
}

// --- Placeholders locais (compõem DS primitives, não substituem nada do DS) ---

function StatCol({
  iconName,
  iconColor,
  iconWidth,
  iconHeight,
  label,
  value,
  width,
  theme,
}: {
  iconName: IconName;
  iconColor?: string;
  iconWidth?: number;
  iconHeight?: number;
  label: string;
  value: string;
  width: number;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={{ alignItems: 'center', gap: theme.gap.sm, width }}>
      <Icon
        name={iconName}
        size={iconWidth || iconHeight ? undefined : 24}
        width={iconWidth}
        height={iconHeight}
        color={iconColor ?? theme.content.dark}
      />
      <Text variant="title.l" color={theme.content.dark}>
        {value}
      </Text>
      <Text variant="body.s" color={theme.content.dark}>
        {label}
      </Text>
    </View>
  );
}

// Divider — vertical SVG with linear gradient (Figma 295:1585 / 304:2455):
// fades #171717 → #62BB81 (midpoint) → #171717 over 106px tall, 1px wide.
function Divider({ theme: _theme }: { theme: ReturnType<typeof useTheme> }) {
  return (
    <Svg width={1} height={106} viewBox="0 0 1 106">
      <Defs>
        <LinearGradient
          id="divider-grad"
          x1="0.5"
          y1="0"
          x2="0.5"
          y2="106"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor="#171717" />
          <Stop offset="0.506" stopColor="#62BB81" />
          <Stop offset="1" stopColor="#171717" />
        </LinearGradient>
      </Defs>
      <Path d="M1 106H0V0H1V106Z" fill="url(#divider-grad)" />
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
