import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../auth/apiConfig';

const TOKEN_KEY = 'swi.auth.token';

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
    const err = new Error(data?.message ?? 'Erro na requisição');
    (err as any).status = res.status;
    throw err;
  }
  return data as T;
}
