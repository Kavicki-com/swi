import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../auth/apiConfig';

const TOKEN_KEY = 'swi.auth.token';

// Há sessão api? Usado pelo apiProfileBackend pra decidir entre PUT imediato
// e stash local (o wizard de onboarding roda ANTES do primeiro login — o
// cadastro só destrava depois da aprovação do admin no painel).
export async function hasToken(): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(TOKEN_KEY));
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  auth?: boolean;
}

// Helper HTTP compartilhado (extraído do req() interno do apiAuthBackend).
// Default de método: body ? 'POST' : 'GET' (aceita override explícito, ex. PUT).
// Com auth, anexa Bearer do token guardado no SecureStore. A message de erro
// já vem pronta do backend.
export async function apiRequest<T = any>(path: string, opts: ApiRequestOptions = {}): Promise<T> {
  const { method, body, auth = false } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const t = await SecureStore.getItemAsync(TOKEN_KEY);
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Anexa o status pro caller distinguir 404 (esperado) de 500/rede (falha real).
    // O class-validator responde `message` como ARRAY ("email must be an email"),
    // e `new Error(['a','b'])` vira "a,b" — junta explícito, igual o painel faz.
    const raw = data?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    const err = new Error(message ?? 'Erro na requisição');
    (err as any).status = res.status;
    throw err;
  }
  return data as T;
}
