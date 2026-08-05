import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Image as RNImage, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Stop, SvgXml } from 'react-native-svg';
import {
  Avatar,
  Button,
  HeartStatus,
  Icon,
  JourneyTheme,
  ProgressBar,
  StatusChart as DSStatusChart,
  Text,
  Title,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system';
import { NavFABs } from '../../components/NavFABs';
import { ActiveAlertModal } from '../../components/modals/ActiveAlertModal';
import { WeatherAlertModal } from '../../components/modals/WeatherAlertModal';
import {
  FIRE_ICON_SVG,
  GAUGE_ICON_SVG,
  HEART_ICON_SVG,
} from '../../lib/dashboardStatIcons';
import { SILHOUETTE_BODY_SVG } from '../../lib/dashboardKnobSvgs';
import {
  ARROW_DOWN_TRIANGLE_SVG,
  ARROW_UP_TRIANGLE_SVG,
  WATER_DROP_SVG,
  WIND_SPEED_SVG,
} from '../../lib/alertWeatherSvgs';
import { useUniqueId, useUniqueSvg } from '../../lib/uniqueSvg';
import { useVitals } from '../../services/vitals/VitalsProvider';
import { useProfile } from '../../services/profile/ProfileProvider';
import { useNotifications } from '../../services/notifications/NotificationProvider';
import { useReports } from '../../services/reports/ReportsProvider';
import { formatEta } from '../../services/vitals/formatEta';
import { useWeather } from '../../services/weather/WeatherProvider';
import { weatherDisplay } from '../../services/weather/weatherFormat';
import type { WorkerStatus } from '../../services/vitals/types';
import { VitalsLoadingState } from '../../components/vitals/VitalsLoadingState';
import { VitalsEmptyState } from '../../components/vitals/VitalsEmptyState';
import { VitalsErrorState } from '../../components/vitals/VitalsErrorState';

// T4.6: memo wrap do StatusChart no nível de módulo. O componente é o mais
// pesado da tree (3 feGaussianBlur filter chains + silhueta + ECG + dots).
// Quando o Dashboard re-renderiza por modal state ou cameraActive, o
// StatusChart skipa re-render desde que suas props sejam estáveis (handlers
// useCallback'd, primitivas literais).
const StatusChart = memo(DSStatusChart);

// Map the domain WorkerStatus to the DS StatusChart condition union
// ('good' | 'alert' | 'low'). StatusChart has no neutral condition, so the
// 'unknown' status (empty/stale/error) falls back to 'good' for the ring while
// the chest heart badge is hidden entirely (see HeartStatus block below).
// SAFETY: this 'good' ring fallback is reachable ONLY because the
// loading/empty/error phases return early ABOVE the StatusChart render, so
// `status` here is always good|alert|low, never 'unknown'. Do NOT render
// StatusChart above the phase gate or 'unknown' would paint the silhouette
// green (a fake-good). Drop the fallback once the DS gains a neutral condition.
function toChartCondition(status: WorkerStatus): 'good' | 'alert' | 'low' {
  return status === 'alert' || status === 'low' ? status : 'good';
}

// Map WorkerStatus to the DS HeartStatus condition ('check' | 'alert' | 'low').
// Returns null for 'unknown' — the caller HIDES the badge in that case.
// DS bump TODO (deferred): neutral heart-status condition; using hide-badge
// fallback for the unknown status.
function toHeartCondition(status: WorkerStatus): 'check' | 'alert' | 'low' | null {
  if (status === 'good') return 'check';
  if (status === 'alert') return 'alert';
  if (status === 'low') return 'low';
  return null;
}

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
// DIVIDER_GRAD_END subido pra #3A3A3A (contraste real contra bg #171717).
// Tentei #2A2A2A antes mas ainda sumia no Android em gaps estreitos.
const DIVIDER_GRAD_END = '#3A3A3A';
const DIVIDER_GRAD_MID = '#62BB81';

const BG_DECOR_PATH =
  'M157.378 347.935H64.0356C57.6845 347.935 52.0472 346.719 47.2773 344.319C43.4537 342.394 40.1798 339.711 37.5464 336.344C35.2057 333.35 33.8158 330.358 33.0606 328.376C32.2419 326.222 31.9795 324.789 31.9687 324.73L31.9621 324.692V324.654C31.9676 321.759 32.5411 34.8651 31.9621 16.3288C31.8434 12.5266 30.3809 9.36409 27.6136 6.92631C23.1094 2.95899 15.8801 1.5623 10.6078 1.08815C4.86064 0.5719 0.126303 1.01253 0.0786841 1.01662L0 0.183997C0.0474149 0.178683 4.84653 -0.269714 10.6683 0.253076C14.0947 0.560046 17.2042 1.13761 19.9099 1.96941C23.3156 3.01622 26.0927 4.47218 28.1654 6.29765C31.1144 8.89321 32.6729 12.2601 32.7992 16.3018C33.3762 34.7895 32.809 319.802 32.7992 324.616C32.8446 324.847 33.1266 326.2 33.8567 328.112C34.5924 330.041 35.949 332.95 38.229 335.858C42.2505 340.986 49.9918 347.099 64.0356 347.099H177.508H295.964C310.008 347.099 317.749 340.986 321.77 335.858C324.051 332.95 325.407 330.041 326.143 328.112C326.873 326.2 327.155 324.847 327.201 324.616C327.19 319.802 326.623 34.7895 327.201 16.3018C327.327 12.2601 328.886 8.89321 331.833 6.29765C333.906 4.47218 336.684 3.01622 340.089 1.96941C342.796 1.13761 345.905 0.560046 349.332 0.253076C355.153 -0.269714 359.953 0.178683 360 0.183997L359.92 1.01662C359.873 1.01253 355.138 0.5719 349.391 1.08815C344.119 1.5623 336.89 2.95899 332.386 6.92631C329.619 9.36409 328.156 12.5266 328.037 16.3288C327.458 34.8651 328.031 321.759 328.038 324.654V324.692L328.03 324.73C328.019 324.789 327.758 326.222 326.938 328.376C326.184 330.358 324.794 333.35 322.452 336.344C319.819 339.711 316.545 342.394 312.721 344.319C307.953 346.719 302.314 347.935 295.964 347.935H157.378Z';
const BG_DECOR_W = 360;
const BG_DECOR_H = 347.935;

// Resolve local PNG to a Metro-served URI so DS Avatar (which only accepts
// `uri: string`) can render the asset. TODO: bump DS Avatar to accept
// `source: ImageSourcePropType` to remove this workaround.

// Layout reference (Figma 245:23280, viewport 360×≈800):
//   - Chart zone: 0,0 → 360×374. Now rendered as edge-to-edge banner with
//     aspectRatio 360/374; children positioned via percentage of that zone.
//   - Bottom container: was left=48 / top=271 / w=266 inside the canvas;
//     now flex column with paddingHorizontal=theme.padding.m and a fixed
//     overlap (marginTop) into the chart zone.
//
// Figma spec is gap.xl=28, but the DS Button DS renders shape="pill" buttons
// ~4px taller than the Figma 56 spec (60h measured) — accumulating ~11px of
// extra height across the 5 container items. Reducing the gap to 24 absorbs
// that overflow so the bottom action row sits within the frame curve as the
// Figma layout shows (was: bell button touching the BG_DECOR bottom edge).
const CONTAINER_GAP_XL = 24;

export default function Dashboard() {
  const { phase, vitals, status } = useVitals();
  const { profile } = useProfile();
  // QA Mobile #2 (30/07/2026): os badges de Relatórios e Notificações eram o
  // literal "4". O contador não vinha de lugar nenhum, então prometia conteúdo
  // que a lista não tinha. Agora saem da contagem real, e somem quando é zero.
  const { unreadCount } = useNotifications();
  const { reports, load: loadReports } = useReports();
  // O ReportsProvider não auto-carrega (o de notificações carrega). Sem este
  // disparo o badge ficaria escondido até o usuário abrir Relatórios uma vez.
  useEffect(() => {
    void loadReports();
  }, [loadReports]);
  const pendingReports = reports.filter((r) => r.status === 'pending').length;
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // SVGs com <defs> precisam de IDs únicos por instância — caso contrário
  // colidem com cópias renderizadas em outras telas montadas em background.
  const gaugeXml = useUniqueSvg(GAUGE_ICON_SVG);
  // Silhouette multiply overlay (Figma Caminho 4123) — stacked on top of the
  // DS StatusChart silhouette with mix-blend-mode:multiply pra match my-stats:
  // dois layers iguais multiplicam o gradient produzindo um verde mais rico/
  // saturado. Sem esse overlay, a silhueta do dashboard parecia mais clara
  // que a de my-stats apesar das stops idênticas (#3EAB2E → #B7E9A4).
  const silhouetteMultiplyXml = useUniqueSvg(SILHOUETTE_BODY_SVG);
  const bgDecorGradId = useUniqueId('bg-decor-grad');
  // Demo-only: camera starts on; tapping the camera button toggles the
  // green status dot. Production wiring would mirror live worker state.
  const [cameraActive, setCameraActive] = useState(true);

  // T4.6: handlers estáveis pra StatusChart memoizado (acima). Sem useCallback,
  // cada re-render do Dashboard criaria nova função e invalidaria o memo.
  const handlePressHeartRate = useCallback(
    () => router.push('/(app)/my-stats'),
    [router],
  );
  const handlePressSettings = useCallback(
    () => router.push('/(app)/settings'),
    [router],
  );

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

  // State-driven alert modals — usados quando o botão "Ajuda urgente" do
  // dashboard é tapped. Trocamos `router.replace('?alert=modal')` (que muda
  // rota e re-renderiza o dashboard inteiro em vermelho) por estados locais
  // que abrem o modal como overlay sem mudar de tela. O fluxo route-based
  // (`?alert=modal` / `?alert=active`) segue intacto pra deep links externos
  // (push notifications, etc.).
  const [weatherModalOpen, setWeatherModalOpen] = useState(false);
  const [activeModalOpen, setActiveModalOpen] = useState(false);

  if (alert === 'active') {
    return <AlertActiveView />;
  }

  // Vitals state takeovers (after all hooks; the route-driven alert-active
  // emergency view above always wins). Full-screen views keep it DS + simple,
  // consistent with my-stats. provider self-polls; retry is a hint.
  if (phase === 'loading') return <VitalsLoadingState />;
  if (phase === 'empty') return <VitalsEmptyState />;
  if (phase === 'error') return <VitalsErrorState onRetry={() => {}} />;

  // ready | stale — vitals is non-null here (computePhase guarantees it).
  const v = vitals!;
  const heartCondition = toHeartCondition(status);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* A2 — Bottom decoration (Figma 304:2430 background-element). Sibling
          do content stack: estica full-viewport pra moldura verde tocar a
          borda da tela em qualquer iPhone. preserveAspectRatio="none" permite
          stretch horizontal não-uniforme. */}
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

      {/* Background gradient PNG renderizado via expo-image (decoder ARGB_8888 no
          Android — RN Image decodifica em RGB_565 e perde a alpha sutil dos blobs
          de glow, virando preto chapado). JourneyTheme sem `gradient` prop pra
          manter só o dot-grid layer. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <ExpoImage
          source={require('../../assets/login-bg.png')}
          contentFit="cover"
          style={{ flex: 1 }}
        />
      </View>
      <JourneyTheme />

      {/* Caminho 4122 agora é renderizado DENTRO do StatusChart DS (v0.1.86+)
          via prop extrapolate={true}. O outer layer aqui foi removido — o DS
          é a source of truth pra todos os elipses + inner shadows + disc
          extrapolation. */}

      {/* Content stack — journey pattern: outer flex:1 with safe-area padding.
          Chart zone is edge-to-edge (no horizontal padding); the bottom
          container gets paddingHorizontal:theme.padding.m on its own. */}
      <View
        style={{
          flex: 1,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        {/* Top zone — Caminho 4122 (outer ring) + Knob + silhouette + heart
            status + heart-rate button + avatar + location pin + camera/briefcase.
            Wrapper aspectRatio 360:431 acomoda o Caminho 4122 que sangra 57px
            abaixo do knob original. Inner sub-zone preserva 360:374 pra todas
            as % existentes dos elementos internos ficarem inalteradas.
            BG_DECOR continua edge-to-edge como sibling. */}
        <View
          style={{
            width: '100%',
            maxWidth: 360,
            aspectRatio: 360 / 431,
            alignSelf: 'center',
            overflow: 'visible',
          }}
        >
        {/* Inner sub-zone — todas as % existentes dos elementos abaixo
             presumem container 360×374. Mantida igual ao layout original. */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            aspectRatio: 360 / 374,
          }}
        >
        {/* StatusChart (DS v0.1.86+) — substitui knob bezel + dot-grid +
             silhueta + heart status + heart-rate button + Elipse 34 + ECG +
             settings gear + Caminho 4122 disc. Canvas 360×374. extrapolate=true
             remove o overflow:hidden e backgroundColor pra permitir o disc
             (background-circle 456.714 dia) sangrar 25.7 acima, 57 abaixo
             e 48 nas laterais do canvas (conforme Figma data). Inner shadows
             nos 4 elipses concêntricos (Figma spec Y=2.08, blur=4.16, #000
             98.82%) também vêm do DS bump 0.1.86. */}
        <StatusChart
          condition={toChartCondition(status)}
          progress={1}
          showActionButton={true}
          renderHeartStatus={false}
          extrapolate
          discDiameter={550}
          onPressHeartRate={handlePressHeartRate}
          onPressSettings={handlePressSettings}
          accessibilityLabel="Status de saúde"
        />

        {/* Silhouette multiply overlay (Figma Caminho 4123) — stacked on top
            do StatusChart silhouette com mix-blend-mode:multiply pra match
            visual com my-stats.tsx (mesmo padrão lá). Geometria casa com
            SILHOUETTE_X=141.9, SILHOUETTE_Y=87.47, w=76.967, h=262.318 do
            DS canvas 360×374 → percentuais 39.42% / 23.39% / 21.38% / 70.14%. */}
        {Platform.OS === 'web' ? (
          // mixBlendMode é web-only; em iOS/Android o overlay vira só uma
          // cópia opaca da silhueta (layer desperdiçada) sem produzir o
          // efeito de multiply. Gate evita parse de SVG + render extra
          // em native.
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: '23.39%',
              left: '39.42%',
              width: '21.38%',
              height: '70.14%',
              // mixBlendMode só tem efeito no RN-web; no native é ignorado.
              mixBlendMode: 'multiply',
            }}
          >
            <SvgXml xml={silhouetteMultiplyXml} width="100%" height="100%" />
          </View>
        ) : null}

        {/* Heart-status badge — extraído do StatusChart (DS v0.1.105+) via
            renderHeartStatus={false} pra ser renderizado MANUALMENTE aqui,
            APÓS o multiply overlay acima. Sem isso, o multiply colorizaria
            o badge (heart + check icon ficavam verdes em vez de manter o
            contraste branco/verde original do design). Coords convertidas
            do HEART_STATUS_OFFSET (canvas 360×374) pra percentuais:
            left 169.2/360 = 47%, top 139.327/374 = 37.25%, size 26.093/374
            ≈ 6.978% (badge é quadrado, então width=height nas %).
            DS bump TODO (deferred): neutral heart-status condition; using
            hide-badge fallback — heartCondition is null for the 'unknown' status
            (here only reachable via 'stale', since loading/empty/error take over
            above), so we hide the badge instead of faking a 'check'. */}
        {heartCondition ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: '47%',
              top: '37.25%',
            }}
          >
            <HeartStatus condition={heartCondition} size={26.093} />
          </View>
        ) : null}

        {/* 5. Avatar — absolute top-right, overlays the chart.
            Pressable wraps the avatar so tapping it opens /(app)/settings.
            Before R-4 (2026-05-17), settings was unreachable from the (app)
            graph — avatar is the canonical iOS/Android profile-entry idiom. */}
        <Pressable
          onPress={() => router.push('/(app)/settings')}
          accessibilityRole="button"
          accessibilityLabel="Abrir configurações"
          hitSlop={8}
          style={{ position: 'absolute', top: '9.09%', right: '6.67%' }}
        >
          <Avatar
            customSize={72}
            uri={profile?.avatarUrl}
            name={profile?.fullName}
            fallbackBackgroundColor={theme.surface.medium}
          />
        </Pressable>

        {/* 6. Location pin button — Figma places this directly below the
             heart-rate button (right edge aligned), inside the chart zone.
             Top:69% sits just under the 41.98%→66% heart-rate band. */}
        <View style={{ position: 'absolute', top: '72.5%', right: '13.33%' }}>
          <Button
            variant="contained"
            size="xlarge"
            shape="pill"
            elevation="lg"
            iconLeft={
              <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                <Icon
                  name="location_pin"
                  width={20}
                  height={25}
                  color={theme.content.light}
                />
              </View>
            }
            accessibilityLabel="Localização"
            onPress={() => router.push('/(app)/map')}
          />
        </View>
        </View>

        {/* 7. Camera button — Figma 245:23280 main-actions row.
             No Figma o button center está em dashboard y=383 (button bottom
             y=411), e a curva inferior do disco no button x está em y=405.93,
             deixando 5px do button bottom EXPOSTO abaixo da curva (espaço
             visível sem disco). bottom:20 = 431-411, posicionando button
             bottom exatamente em chart-zone y=411 conforme Figma. */}
        <View style={{ position: 'absolute', bottom: 20, left: 48 }}>
          <Button
            variant="outline"
            size="large"
            shape="pill"
            borderColor={theme.content.dark}
            borderWidth="s"
            iconLeft={
              <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                <Icon
                  name="video_camera_back"
                  width={20}
                  height={16}
                  color={theme.content.dark}
                />
              </View>
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

        {/* 8. Briefcase button — Mesma posição vertical do camera button
             (Figma 245:23280 main-actions row), espelhada horizontalmente.
             5px do button bottom exposto abaixo da curva inferior do disco. */}
        <View style={{ position: 'absolute', bottom: 20, right: 48 }}>
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
      </View>

      {/* Bottom container — Figma 304:2858 ancora em left:48 do viewport 360
          (container w:266 + right:46). paddingHorizontal:48 alinha com a
          parede interna do BG_DECOR; theme.padding.l (24) deixava badges
          colados na parede esquerda no Android. */}
      <View
        style={{
          width: '100%',
          maxWidth: 360,
          alignSelf: 'center',
          paddingHorizontal: 48,
          gap: CONTAINER_GAP_XL,
          alignItems: 'flex-end',
        }}
      >
        {/* User stats: 3 cols + dividers (Figma 304:2456 → justify-between).
            cols 41/65/55, dividers 1×106.146. Wrap do "12/8" no Android é
            resolvido via numberOfLines=1 no Title (StatCol abaixo), não
            aumentando width — preserva fidelidade Figma. */}
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
            value={String(v.heartRate)}
            label="BPM"
            // 41 (Figma) só comportava 2 dígitos, e mal: o simulador vai de 40
            // a 140 BPM, então 3 dígitos são esperados, não exceção. 70 é a
            // mesma largura da coluna de Kcal, que já segura "184" — e segue o
            // precedente das outras duas, que também subiram do valor do Figma
            // quando o texto quebrava (65→80 e 55→70).
            width={70}
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
            value={`${v.bloodPressureSys}/${v.bloodPressureDia}`}
            label="Boa"
            width={80}
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
            value={String(Math.round(v.caloriesPerHour))}
            label="Kcal/hora"
            width={70}
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
            value={Math.round(v.fatiguePct)}
            gradient={[
              theme.surface.success,
              theme.surface.warning,
              theme.surface.error,
            ]}
            gradientStops={[43.75, 79.253, 100]}
            gradientDirection="rtl"
            bordered
            accessibilityLabel="Tempo até atingir fadiga total"
          />
          <Text variant="body.m" color={theme.content.dark}>
            Tempo até atingir fadiga total: {formatEta(v.fatigueEtaMin)}
          </Text>
        </View>

        {/* 5. Bottom actions row: reports + notif (with badge "4") + chat + help.
            justifyContent:'space-evenly' distribui os 4 gaps (edges + entre
            elementos) com tamanho igual — mais respiração visual nas pontas
            do que 'space-between' (que cola stack-left na parede esquerda e
            SOS na parede direita). Auto-adapta a viewports variados sem
            depender de gap fixo. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-evenly',
            width: '100%',
          }}
        >
          <View style={{ gap: theme.gap.s }}>
            {/* Contagens REAIS, não mais o literal "4" (QA Mobile #2). Sem
                pendências, o badge some em vez de anunciar conteúdo que a
                lista não tem. O rótulo acessível acompanha o número. */}
            <BadgedButton
              icon="reports_filled"
              badge={pendingReports > 0 ? String(pendingReports) : undefined}
              accessibilityLabel={
                pendingReports > 0
                  ? `Relatórios, ${pendingReports} pendente${pendingReports > 1 ? 's' : ''}`
                  : 'Relatórios'
              }
              onPress={() => router.push('/(app)/reports')}
              theme={theme}
            />
            <BadgedButton
              icon="notifications"
              badge={unreadCount > 0 ? String(unreadCount) : undefined}
              accessibilityLabel={
                unreadCount > 0
                  ? `Notificações, ${unreadCount} não lida${unreadCount > 1 ? 's' : ''}`
                  : 'Notificações'
              }
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
          {/* Wrap 56×56 força dimensões iguais → shape="pill" vira circular.
              Sem o wrap, DS Button size="large" + ícone 18×22 (narrow/tall)
              calculava paddings horizontal/vertical diferentes e o pill
              ficava OVAL (bug Fix 6 reportado pelo cliente). Mesmo pattern
              do BadgedButton (linha ~810) que já estava enforcando 56×56. */}
          <View style={{ width: 56, height: 56 }}>
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
              onPress={() => setWeatherModalOpen(true)}
            />
          </View>
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

      {/* State-driven weather alert modal — opens when "Ajuda urgente" button
          is tapped. Backdrop com tint vermelho leve (mesmo padrão da
          notifications.tsx); dashboard underneath não muda de cor. CTA
          "Instruções de segurança" → fecha esse e abre o ActiveAlertModal. */}
      <Modal
        visible={weatherModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setWeatherModalOpen(false)}
      >
        <Pressable
          onPress={() => setWeatherModalOpen(false)}
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.padding.m,
            backgroundColor: 'rgba(245, 102, 122, 0.18)',
          }}
        >
          {/* Pressable interno = stop-propagation do tap no conteudo.
              Precisa carregar os mesmos constraints de largura que o
              WeatherAlertModal espera (width:100%, maxWidth:320). Sem
              isso, o wrapper colapsa pra content-width, o width:100% do
              modal interno fica sem referencia e o pill do Button colapsa
              pra content-width tambem (desalinhamento visivel). */}
          <Pressable
            onPress={() => {}}
            style={{ width: '100%', maxWidth: 320 }}
          >
            <WeatherAlertModal
              onClose={() => setWeatherModalOpen(false)}
              onPrimaryAction={() => {
                setWeatherModalOpen(false);
                setActiveModalOpen(true);
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* State-driven active alert modal — abre a partir do CTA do weather
          modal. Conteúdo gerenciado pelo próprio componente (RN Modal interno
          + backdrop vermelho + tap-outside-to-close). */}
      <ActiveAlertModal
        visible={activeModalOpen}
        onClose={() => setActiveModalOpen(false)}
      />
    </View>
  );
}

// --- Placeholders locais (compõem DS primitives, não substituem nada do DS) ---

const StatCol = memo(function StatCol({
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
      {/* numberOfLines=1 é OBRIGATÓRIO aqui: sem ele o valor quebra em duas
          linhas, a coluna cresce em altura e empurra os ícones do rodapé pra
          fora da margem (QA no aparelho, 2026-07-27: BPM 64 renderizou "6"
          sobre "4"). O comentário no call site já afirmava que isto existia —
          não existia. */}
      <Title variant="title.l" color={theme.content.dark} numberOfLines={1}>
        {value}
      </Title>
      <Text variant="body.s" color={theme.content.dark}>
        {label}
      </Text>
    </View>
  );
});

// Divider — vertical SVG with linear gradient (Figma 295:1585 / 304:2455):
// fades #171717 → #62BB81 (midpoint) → #171717 over 106px tall, 1px wide.
const Divider = memo(function Divider({ theme: _theme }: { theme: ReturnType<typeof useTheme> }) {
  const gradId = useUniqueId('divider-grad');
  return (
    <Svg width={2} height={106} viewBox="0 0 2 106">
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
          <Stop offset="0.2" stopColor={DIVIDER_GRAD_MID} />
          <Stop offset="0.8" stopColor={DIVIDER_GRAD_MID} />
          <Stop offset="1" stopColor={DIVIDER_GRAD_END} />
        </LinearGradient>
      </Defs>
      <Path d="M2 106H0V0H2V106Z" fill={`url(#${gradId})`} />
    </Svg>
  );
});

const BadgedButton = memo(function BadgedButton({
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
          // pointerEvents="none" (QA Mobile #2): o badge é absoluto sobre o
          // quadrante superior direito do botão de 56×56. Sem isto ele CAPTURA
          // o toque que cai nos seus 24×24 e não faz nada com ele — e o badge é
          // justamente a parte mais chamativa, que o usuário tende a mirar.
          pointerEvents="none"
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
});

// --- Alert-active view (Figma 385:29591 dashboard-alert-active) ---
// Anteriormente vivia em `app/(app)/alert-instructions.tsx`. Por decisão
// 2026-05-15, dashboard e alert-instructions são o mesmo screen com 2
// estados; este componente serve o branch `?alert=active`.
function AlertActiveView() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Clima real (Unit 2) com fallback pro texto estático de hoje em
  // loading/error/sem-alerta — esta é tela de segurança e nunca pode quebrar.
  const { snapshot, activeAlert } = useWeather();
  const { tempStr, condStr, humStr, windStr, maxStr, minStr, descStr } = weatherDisplay(snapshot, activeAlert);

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
              {tempStr}
            </Title>
            <Text variant="body.m" color={theme.content.dark}>
              {condStr}
            </Text>
          </View>

          {/* Right: data column (Figma 385:30123). Width fixa 83px. Os
              4 ícones vêm dos SVGs do Figma (alertWeatherSvgs) porque
              os equivalentes do DS têm shapes diferentes. */}
          <View style={{ width: 83, gap: theme.gap.s }}>
            <WeatherDataRow svg={WATER_DROP_SVG} svgW={14} svgH={20} value={humStr} theme={theme} />
            <WeatherDataRow svg={WIND_SPEED_SVG} svgW={20} svgH={17} value={windStr} theme={theme} />
            <WeatherDataRow svg={ARROW_UP_TRIANGLE_SVG} svgW={22} svgH={19} value={maxStr} theme={theme} />
            <WeatherDataRow svg={ARROW_DOWN_TRIANGLE_SVG} svgW={22} svgH={19} value={minStr} theme={theme} />
          </View>
        </View>

        {/* Description */}
        <Text
          variant="body.s"
          color={theme.content.dark}
          style={{ textAlign: 'center' }}
        >
          {descStr}
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
                    width={20}
                    height={25}
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
