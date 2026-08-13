import { memo, useCallback, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
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
  useTheme,
} from '@kavicki/swi-design-system';
import { ActiveAlertModal } from '../../components/modals/ActiveAlertModal';
import { WeatherAlertModal } from '../../components/modals/WeatherAlertModal';
import { AlertActiveView } from '../../components/dashboard/AlertActiveView';
import { BadgedButton } from '../../components/dashboard/BadgedButton';
import { StatCol } from '../../components/dashboard/StatCol';
import { StatDivider } from '../../components/dashboard/StatDivider';
import {
  FIRE_ICON_SVG,
  GAUGE_ICON_SVG,
  HEART_ICON_SVG,
} from '../../lib/dashboardStatIcons';
import { SILHOUETTE_BODY_SVG } from '../../lib/dashboardKnobSvgs';
import {
  BG_DECOR_GRAD_BOTTOM,
  BG_DECOR_GRAD_BOTTOM_ALERT,
  BG_DECOR_GRAD_TOP,
  BG_DECOR_GRAD_TOP_ALERT,
  BG_DECOR_H,
  BG_DECOR_PATH,
  BG_DECOR_W,
} from '../../lib/dashboardDecor';
import { useUniqueId, useUniqueSvg } from '../../lib/uniqueSvg';
import { useVitals } from '../../services/vitals/VitalsProvider';
import { useProfile } from '../../services/profile/ProfileProvider';
import { useNotifications } from '../../services/notifications/NotificationProvider';
import { useReports } from '../../services/reports/ReportsProvider';
import { formatEta } from '../../services/vitals/formatEta';
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

// As constantes de desenho da moldura de fundo e do divisor moram em
// lib/dashboardDecor.ts, ao lado de dashboardStatIcons e dashboardKnobSvgs.

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
          // Overlay web-only de propósito: poupa parse de SVG e uma camada
          // extra no native. Com a new arch (RN 0.76+) o native até suporta
          // mixBlendMode, mas o efeito só foi validado visualmente no web.
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: '23.39%',
              left: '39.42%',
              width: '21.38%',
              height: '70.14%',
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
          <StatDivider />
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
          <StatDivider />
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
