import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../services/auth/AuthProvider';
import { JourneyProvider } from '../../services/journey/JourneyProvider';
import { EvacuationProvider } from '../../services/evacuation/EvacuationProvider';
import { NotificationProvider } from '../../services/notifications/NotificationProvider';

// Auth gate: rotas em `(app)/*` exigem usuário autenticado.
// Demo phase: estado em memória (sem AsyncStorage), então um cold
// start sem login derruba qualquer deep-link `(app)/*` para /login.
//
// JourneyProvider envolve só o tree autenticado — shared state vive
// durante a sessão e reseta naturalmente no logout (provider remonta).
export default function AppLayout() {
  const { user } = useAuth();

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  // NotificationProvider subiu pra cá (QA Mobile #2, 30/07/2026). Antes vivia
  // DENTRO da tela de notificações, então só existia enquanto ela estava
  // aberta, e o dashboard não tinha como saber quantas há — por isso o badge
  // era o literal "4". Aqui ele acompanha a sessão inteira, como Journey e
  // Evacuation, e o badge lê a contagem real.
  //
  // Precisa ser UMA instância só: com um provider aninhado na tela, a lista e
  // o badge seriam estados independentes e o badge não zeraria ao ler.
  return (
    <JourneyProvider>
      <EvacuationProvider>
        <NotificationProvider>
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
        </NotificationProvider>
      </EvacuationProvider>
    </JourneyProvider>
  );
}
