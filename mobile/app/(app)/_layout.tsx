import { Platform } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../services/auth/AuthProvider';
import { JourneyProvider, useJourney } from '../../services/journey/JourneyProvider';
import { EvacuationProvider } from '../../services/evacuation/EvacuationProvider';
import { NotificationProvider, useNotifications } from '../../services/notifications/NotificationProvider';
import { HelpRequestProvider } from '../../services/help/HelpRequestProvider';
import { useJourneyTracking } from '../../services/positions/useTrackingLifecycle';
import {
  latestEvacuationNotice,
  useEvacuationTracking,
} from '../../services/positions/useEvacuationTracking';
import { isFeatureEnabled } from '../../lib/featureFlags';
import { useBandChoice } from '../../services/telemetry/bluetooth/bluetoothBandChoice';
import { useBluetoothHeartRate } from '../../services/telemetry/bluetooth/useBluetoothHeartRate';
import { useTelemetryUploadState } from '../../services/telemetry/TelemetryUploadProvider';
import { useReadinessReport } from '../../services/telemetry/useReadinessReport';
import { useEndLiveOnLeave } from '../../services/live/useLiveBroadcast';
import { SendQueueRoot } from '../../components/outbox/SendQueueRoot';
import { LiveSelfView } from '../../components/LiveSelfView';

// GPS em segundo plano: liga com a jornada em andamento ou pausada e desliga
// quando ela encerra. Null-render, dentro do JourneyProvider para ler a
// jornada; a jornada só conta depois de carregada, do servidor ou da cópia
// guardada (app aberto sem sinal), e da cópia só retoma a janela já aberta.
function JourneyTrackingRoot({ userId }: { userId: string }) {
  const { state, loadStatus, source } = useJourney();
  useJourneyTracking(
    userId,
    state,
    loadStatus === 'ready' || loadStatus === 'empty',
    undefined,
    source === 'cache' ? 'cache' : 'server',
  );
  return null;
}

// GPS em segundo plano durante a evacuação: com evacuação ativa liga mesmo
// sem jornada, pede a permissão e segue até o gestor encerrar no painel.
// Null-render, dentro do NotificationProvider: a notificação de evacuação que
// chega pelo socket é a deixa para consultar na hora.
function EvacuationTrackingRoot({ userId }: { userId: string }) {
  const { notifications } = useNotifications();
  useEvacuationTracking(userId, latestEvacuationNotice(notifications));
  return null;
}

// Batimento ao vivo pela pulseira no Bluetooth: a escuta segue a jornada e a
// janela do GPS, com a pulseira escolhida em Configurações e o aparelho
// pareado. Montada depois do GPS: lê a janela que ele abre no mesmo render.
// Null-render, só com o gate (Android compilado).
function BluetoothHeartRateRoot({ userId }: { userId: string }) {
  const { state, loadStatus, source } = useJourney();
  const { paired } = useTelemetryUploadState();
  const choice = useBandChoice();
  useBluetoothHeartRate({
    userId,
    journeyState: state,
    journeyKnown: loadStatus === 'ready' || loadStatus === 'empty',
    journeySource: source === 'cache' ? 'cache' : 'server',
    paired,
    deviceId: choice === undefined ? undefined : (choice?.deviceId ?? null),
  });
  return null;
}

// Relato de prontidão ao backend: os fatos do aparelho que o painel mostra
// ao gestor, enviados quando mudam e a cada sincronização. Null-render, só no
// Android com o gate do Health Connect.
function ReadinessReportRoot() {
  useReadinessReport();
  return null;
}

// Câmera ao vivo: segue em qualquer tela da área autenticada e acaba ao sair
// da conta, quando esta árvore desmonta. Null-render.
function LiveBroadcastRoot() {
  useEndLiveOnLeave();
  return null;
}

// Auth gate: rotas em `(app)/*` exigem usuário autenticado. Enquanto o
// AuthProvider restaura a sessão guardada, segura o julgamento: redirecionar
// nesse intervalo derrubaria deep-link válido pro login antes de o /auth/me
// responder.
//
// JourneyProvider envolve só o tree autenticado — shared state vive
// durante a sessão e reseta naturalmente no logout (provider remonta).
export default function AppLayout() {
  const { user, restoring } = useAuth();

  if (restoring) return null;

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  // DENTRO da tela de notificações, então só existia enquanto ela estava
  // aberta, e o dashboard não tinha como saber quantas há — por isso o badge
  // era o literal "4". Aqui ele acompanha a sessão inteira, como Journey e
  // Evacuation, e o badge lê a contagem real.
  //
  // Precisa ser UMA instância só: com um provider aninhado na tela, a lista e
  // o badge seriam estados independentes e o badge não zeraria ao ler.
  return (
    <JourneyProvider userId={user.id}>
      <JourneyTrackingRoot userId={user.id} />
      {isFeatureEnabled('bluetoothHeartRate') && <BluetoothHeartRateRoot userId={user.id} />}
      <LiveBroadcastRoot />
      {Platform.OS === 'android' && isFeatureEnabled('healthConnect') && <ReadinessReportRoot />}
      <EvacuationProvider>
        <NotificationProvider>
          <EvacuationTrackingRoot userId={user.id} />
          {/* Pedido de ajuda: um só para a sessão. O dashboard pede, e o
              procedimento de evacuação, aberto de qualquer tela, mostra o
              estado. Segue tentando sem sinal enquanto a sessão existir. */}
          <HelpRequestProvider>
            <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
            <SendQueueRoot userId={user.id} />
            {/* Self-view da câmera: miniatura flutuante sobre qualquer tela
                enquanto a transmissão está no ar. Null-render fora do ar. */}
            <LiveSelfView />
          </HelpRequestProvider>
        </NotificationProvider>
      </EvacuationProvider>
    </JourneyProvider>
  );
}
