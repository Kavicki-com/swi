import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../services/auth/AuthProvider';
import { JourneyProvider } from '../../services/journey/JourneyProvider';

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

  return (
    <JourneyProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </JourneyProvider>
  );
}
