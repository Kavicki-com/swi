import { mockChatBackend } from './mockChatBackend';
import { conversationKey } from './chatReducers';

describe('mockChatBackend', () => {
  it('myId é "me"', () => {
    expect(mockChatBackend.myId).toBe('me');
  });
  it('listDirectory retorna o roster semeado', async () => {
    const dir = await mockChatBackend.listDirectory();
    expect(dir.length).toBeGreaterThanOrEqual(8);
    expect(dir[0]).toHaveProperty('name');
    expect(dir[0]).toHaveProperty('workerId');
  });
  it('listConversations vem ordenado por recência (desc)', async () => {
    const cs = await mockChatBackend.listConversations();
    expect(cs.length).toBeGreaterThan(0);
    for (let i = 1; i < cs.length; i++) {
      expect((cs[i - 1].lastMessageAt ?? '') >= (cs[i].lastMessageAt ?? '')).toBe(true);
    }
  });
  it('listMessages retorna o histórico de uma conversa conhecida', async () => {
    const [first] = await mockChatBackend.listConversations();
    const msgs = await mockChatBackend.listMessages(first.id);
    expect(Array.isArray(msgs)).toBe(true);
  });
  it('sendMessage anexa, emite ao subscriber e dá bump na conversa', async () => {
    const [first] = await mockChatBackend.listConversations();
    const received: string[] = [];
    const unsub = mockChatBackend.subscribe(first.id, (m) => received.push(m.body));
    const sent = await mockChatBackend.sendMessage(first.id, 'olá real-time');
    expect(sent.senderId).toBe('me');
    expect(received).toContain('olá real-time');
    const msgs = await mockChatBackend.listMessages(first.id);
    expect(msgs[msgs.length - 1].body).toBe('olá real-time');
    const cs = await mockChatBackend.listConversations();
    expect(cs.find((c) => c.id === first.id)?.lastMessageBody).toBe('olá real-time');
    unsub();
  });
  it('subscriber global (null) recebe mensagem de qualquer conversa', async () => {
    const [first] = await mockChatBackend.listConversations();
    const seen: string[] = [];
    const unsub = mockChatBackend.subscribe(null, (m) => seen.push(m.conversationId));
    await mockChatBackend.sendMessage(first.id, 'ping');
    expect(seen).toContain(first.id);
    unsub();
  });
  it('unsubscribe para de receber', async () => {
    const [first] = await mockChatBackend.listConversations();
    const seen: string[] = [];
    const unsub = mockChatBackend.subscribe(first.id, (m) => seen.push(m.body));
    unsub();
    await mockChatBackend.sendMessage(first.id, 'não deveria chegar');
    expect(seen).not.toContain('não deveria chegar');
  });
  it('markRead zera o unread do viewer', async () => {
    const cs = await mockChatBackend.listConversations();
    const withUnread = cs.find((c) => (c.unreadBy.me ?? 0) > 0);
    if (withUnread) {
      await mockChatBackend.markRead(withUnread.id);
      const after = (await mockChatBackend.listConversations()).find((c) => c.id === withUnread.id);
      expect(after?.unreadBy.me ?? 0).toBe(0);
    }
  });
  it('sendMessage cria a conversa lazy se não existir (id determinístico do diretório)', async () => {
    const dir = await mockChatBackend.listDirectory();
    const existing = await mockChatBackend.listConversations();
    const fresh = dir.find((c) => !existing.some((x) => x.participants.includes(c.workerId))) ?? dir[dir.length - 1];
    const key = conversationKey('me', fresh.workerId);
    await mockChatBackend.sendMessage(key, 'primeira mensagem');
    const conv = (await mockChatBackend.listConversations()).find((c) => c.id === key);
    expect(conv).toBeDefined();
    expect(conv?.participants).toEqual(expect.arrayContaining(['me', fresh.workerId]));
  });
});
