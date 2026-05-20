import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../services/auth/AuthProvider';

// Auth gate: rotas em `(app)/*` exigem usuário autenticado.
// Demo phase: estado em memória (sem AsyncStorage), então um cold
// start sem login derruba qualquer deep-link `(app)/*` para /login.
export default function AppLayout() {
  const { user } = useAuth();

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
