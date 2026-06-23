// Lógica PURA da lista de conversas, compartilhada pelo mock backend e pelo
// ChatProvider. Sem efeitos/relógio: `sentAt` chega pronto na Message; ordenação
// por ISO string (lexicográfica = cronológica). Espelha o estilo puro de
// services/journey/progress.ts.
import type { Conversation, Message } from './types';

export function conversationKey(a: string, b: string): string {
  return [a, b].sort().join('#');
}

export function unreadFor(c: Conversation, myId: string): number {
  return c.unreadBy[myId] ?? 0;
}

export interface ResolvedContact {
  workerId: string;
  name: string;
  subtitle: string;
  avatarUri: string;
}

export function resolveContact(c: Conversation, myId: string): ResolvedContact {
  const found = c.participants.findIndex((p) => p !== myId);
  const i = found === -1 ? 0 : found;
  return {
    workerId: c.participants[i] ?? '',
    name: c.participantNames[i] ?? '',
    subtitle: c.participantSubtitles[i] ?? '',
    avatarUri: c.participantAvatars[i] ?? '',
  };
}

export function sortByRecent(cs: Conversation[]): Conversation[] {
  return [...cs].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
}

export function applyMessage(cs: Conversation[], msg: Message): Conversation[] {
  const next = cs.map((c) => {
    if (c.id !== msg.conversationId) return c;
    const unreadBy = { ...c.unreadBy };
    for (const p of c.participants) {
      if (p !== msg.senderId) unreadBy[p] = (unreadBy[p] ?? 0) + 1;
    }
    return {
      ...c,
      lastMessageBody: msg.body || (msg.imageUri ? '📷 Imagem' : ''),
      lastMessageAt: msg.sentAt,
      unreadBy,
    };
  });
  return sortByRecent(next);
}

export function markRead(cs: Conversation[], conversationId: string, myId: string): Conversation[] {
  return cs.map((c) =>
    c.id === conversationId ? { ...c, unreadBy: { ...c.unreadBy, [myId]: 0 } } : c,
  );
}
