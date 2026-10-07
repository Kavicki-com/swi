import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../services/auth/AuthProvider';
import { JourneyProvider, useJourney } from '../../services/journey/JourneyProvider';
import { EvacuationProvider } from '../../services/evacuation/EvacuationProvider';
import { NotificationProvider } from '../../services/notifications/NotificationProvider';
import { useJourneyTracking } from '../../services/positions/useTrackingLifecycle';
import { useEndLiveOnLeave } from '../../services/live/useLiveBroadcast';
import { SendQueueRoot } from '../../components/outbox/SendQueueRoot';

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
      <LiveBroadcastRoot />
      <EvacuationProvider>
        <NotificationProvider>
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
          <SendQueueRoot userId={user.id} />
        </NotificationProvider>
      </EvacuationProvider>
    </JourneyProvider>
  );
}
