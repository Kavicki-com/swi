import * as SecureStore from 'expo-secure-store';
import type { User } from '../types';

// Cópia mínima da sessão, para o app abrir sem sinal: quem é a pessoa e
// quando o servidor confirmou a sessão pela última vez. Só id, e-mail e nome;
// perfil, saúde e o resto continuam vindo do servidor.
//
// Legível depois do primeiro desbloqueio, como o token: o iOS relança o app no
// bolso para o GPS, e a abertura precisa ler as duas coisas.

const SESSION_KEY = 'swi.auth.session';
const VERSION = 1;

/**
 * Por quanto tempo a cópia abre o app sem o servidor confirmar. É a validade
 * de um envio na fila e o teto do servidor para ação da jornada: o que se
 * fizesse depois disso seria descartado de qualquer jeito.
 */
export const OFFLINE_SESSION_MAX_MS = 72 * 60 * 60 * 1000;

export interface StoredSession {
  user: User;
  /** Última confirmação do servidor, em ISO-8601. */
  confirmedAt: string;
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** O que o `/auth/me` devolve quando é mesmo a API respondendo. */
export function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) return false;
  const { id, email, name } = value as Record<string, unknown>;
  return isText(id) && id.length > 0 && isText(email) && isText(name);
}

export async function readStoredSession(): Promise<StoredSession | null> {
  let text: string | null;
  try {
    text = await SecureStore.getItemAsync(SESSION_KEY);
  } catch {
    return null;
  }
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { v, user, confirmedAt } = parsed as Record<string, unknown>;
  if (v !== VERSION || !isUser(user) || !isText(confirmedAt)) return null;
  return { user: { id: user.id, email: user.email, name: user.name }, confirmedAt };
}

export async function writeStoredSession(user: User, now: Date): Promise<void> {
  const text = JSON.stringify({
    v: VERSION,
    user: { id: user.id, email: user.email, name: user.name },
    confirmedAt: now.toISOString(),
  });
  try {
    await SecureStore.setItemAsync(SESSION_KEY, text, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  } catch {
    // Sem a acessibilidade pedida a cópia ainda serve com o aparelho
    // desbloqueado, que é quando alguém abre o app.
    await SecureStore.setItemAsync(SESSION_KEY, text);
  }
}

export async function clearStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

/**
 * Folga para a confirmação "no futuro": relógio adiantado na gravação e
 * acertado depois. Além dela a cópia não vale, senão valeria para sempre.
 */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** A cópia ainda abre o app sem o servidor: menos de 72 h desde a confirmação. */
export function isFresh(stored: StoredSession, now: Date): boolean {
  const at = Date.parse(stored.confirmedAt);
  if (Number.isNaN(at)) return false;
  const elapsed = now.getTime() - at;
  return elapsed > -CLOCK_SKEW_MS && elapsed < OFFLINE_SESSION_MAX_MS;
}
