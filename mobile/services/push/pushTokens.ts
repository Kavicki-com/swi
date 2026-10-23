import { apiRequest } from '../api/http';

// As rotas de token de push do backend. Upsert pelo token: registrar de novo
// é idempotente, e o mesmo aparelho com outra conta passa a ser da conta nova.
// A remoção responde 204 mesmo sem apagar nada, então o logout nunca falha
// por ela; o token vai no corpo, e não no caminho, para não cair em log.

export type PushPlatform = 'android' | 'ios';

/**
 * Prazo da remoção no logout. O logout espera por ela antes de apagar o JWT
 * (a rota exige autenticação), e sem sinal a saída não pode ficar presa nos
 * 20 s do prazo padrão.
 */
export const PUSH_UNREGISTER_TIMEOUT_MS = 3_000;

export async function sendPushToken(token: string, platform: PushPlatform): Promise<void> {
  await apiRequest<void>('/push/tokens', { method: 'POST', body: { token, platform }, auth: true });
}

export async function deletePushToken(token: string): Promise<void> {
  await apiRequest<void>('/push/tokens', {
    method: 'DELETE',
    body: { token },
    auth: true,
    timeoutMs: PUSH_UNREGISTER_TIMEOUT_MS,
  });
}
