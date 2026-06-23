// Lógica PURA da lista de notificações, compartilhada pelo mock e pelo provider.
// Sem efeitos/relógio: createdAt chega pronto. Ordenação por ISO string
// (lexicográfica = cronológica, recente-primeiro). Espelha chatReducers.ts.
import type { AppNotification } from './types';

export function sortByRecent(ns: AppNotification[]): AppNotification[] {
  return [...ns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function applyNotification(ns: AppNotification[], n: AppNotification): AppNotification[] {
  // update-or-insert por id (dedupe), depois re-ordena recente-primeiro.
  const without = ns.filter((x) => x.id !== n.id);
  return sortByRecent([...without, n]);
}

export function markRead(ns: AppNotification[], id: string): AppNotification[] {
  return ns.map((n) => (n.id === id ? { ...n, read: true } : n));
}

export function markAllRead(ns: AppNotification[]): AppNotification[] {
  return ns.map((n) => (n.read ? n : { ...n, read: true }));
}

export function unreadCount(ns: AppNotification[]): number {
  return ns.reduce((acc, n) => (n.read ? acc : acc + 1), 0);
}
