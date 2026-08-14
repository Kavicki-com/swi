import { apiRequest } from './http';

export interface SupportRequest {
  /** Motivo escolhido no combo. Backend aceita 1–120 caracteres. */
  reason: string;
  title: string;
  message: string;
  /** Canal de resposta quando não há sessão (o modal abre também no login). */
  email?: string;
}

/**
 * Envia uma solicitação de suporte.
 *
 * `POST /support` recebe um DTO que espelha o modal campo a campo. É rota
 * PÚBLICA de propósito: o modal também abre na tela de login, onde não há
 * sessão. Por isso não leva `auth: true`, e o OptionalJwtAuthGuard vincula o
 * userId sozinho quando o token existe.
 */
export function createSupportRequest(input: SupportRequest): Promise<void> {
  return apiRequest<void>('/support', { method: 'POST', body: input });
}
