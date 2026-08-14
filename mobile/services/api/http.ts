import * as SecureStore from 'expo-secure-store';
import { getApiUrl } from '../auth/apiConfig';

const TOKEN_KEY = 'swi.auth.token';

// Há sessão api? Usado pelo apiProfileBackend pra decidir entre PUT imediato
// e stash local (o wizard de onboarding roda ANTES do primeiro login: o
// cadastro só destrava depois da aprovação do admin no painel).
export async function hasToken(): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(TOKEN_KEY));
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  auth?: boolean;
  /** Prazo desta chamada. Só suba para operações longas (upload). */
  timeoutMs?: number;
}

// Prazo padrão de QUALQUER chamada à API.
//
// Toda requisição termina dentro de um prazo para que a UI possa encerrar o
// estado de carregamento mesmo quando a conexão não responde.
//
// O React Native não protege: o OkHttp que ele monta vem com connect/read/write
// timeout em 0, ou seja, infinito. Então o prazo é nosso.
//
// 20 s: folgado para 3G ruim e curto o bastante para virar erro acionável.
export const REQUEST_TIMEOUT_MS = 20_000;

/** Distingue "estourou o prazo" de erro do backend (que vem com `status`). */
export function isTimeoutError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === 'TIMEOUT';
}

/**
 * Roda `work` com prazo. Duas garantias, de propósito:
 *
 *  - REJEITA no prazo, por corrida, mesmo que o `work` ignore o sinal.
 *  - ABORTA junto, pra a conexão morrer em vez de ficar ocupando slot (o
 *    OkHttp do Android só deixa 5 requisições simultâneas por host).
 *
 * O prazo cobre a operação INTEIRA, não só o fetch: a leitura do token no
 * SecureStore é async e também pode não voltar.
 */
export async function withDeadline<T>(
  timeoutMs: number,
  message: string,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error(message);
      (err as any).code = 'TIMEOUT';
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// Helper HTTP compartilhado (extraído do req() interno do apiAuthBackend).
// Default de método: body ? 'POST' : 'GET' (aceita override explícito, ex. PUT).
// Com auth, anexa Bearer do token guardado no SecureStore. A message de erro
// já vem pronta do backend.
export function apiRequest<T = any>(path: string, opts: ApiRequestOptions = {}): Promise<T> {
  return withDeadline(
    opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
    'Tempo esgotado. Verifique sua conexão e tente novamente.',
    (signal) => send<T>(path, opts, signal),
  );
}

async function send<T>(path: string, opts: ApiRequestOptions, signal: AbortSignal): Promise<T> {
  const { method, body, auth = false } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const t = await SecureStore.getItemAsync(TOKEN_KEY);
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${getApiUrl()}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Anexa o status pro caller distinguir 404 (esperado) de 500/rede (falha real).
    // O class-validator responde `message` como ARRAY ("email must be an email"),
    // e `new Error(['a','b'])` vira "a,b": junta explícito, igual o painel faz.
    const raw = data?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    const err = new Error(message ?? 'Erro na requisição');
    (err as any).status = res.status;
    throw err;
  }
  return data as T;
}
