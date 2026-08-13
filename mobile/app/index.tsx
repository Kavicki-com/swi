import { Redirect } from 'expo-router';
import { useAuth } from '../services/auth/AuthProvider';

// Root index: decide rota inicial depois que o AuthProvider restaura a
// sessão guardada (SecureStore → /auth/me). Decidir DURANTE a restauração
// mandaria todo cold start pro login mesmo com token válido; o splash
// nativo ainda está na tela nesse intervalo, então render null não pisca.
export default function Index() {
  const { user, restoring } = useAuth();
  if (restoring) return null;
  return <Redirect href={user ? '/(app)/dashboard' : '/(auth)/login'} />;
}
