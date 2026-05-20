import { Redirect } from 'expo-router';
import { useAuth } from '../services/auth/AuthProvider';

// Root index: decide rota inicial baseado no estado de auth in-memory.
// Demo phase: `AuthProvider` é volátil, então toda cold start vai cair
// no login. Quando integrarmos AsyncStorage, esta lógica se mantém.
export default function Index() {
  const { user } = useAuth();
  return <Redirect href={user ? '/(app)/dashboard' : '/(auth)/login'} />;
}
