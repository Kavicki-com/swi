import {
  conversationKey, unreadFor, resolveContact, sortByRecent, applyMessage, markRead,
} from './chatReducers';
import type { Conversation, Message } from './types';

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'me#1',
  participants: ['me', '1'],
  participantNames: ['Você', 'Romulo Cardoso'],
  participantSubtitles: ['', 'Setor Leste'],
  participantAvatars: ['me.png', 'romulo.png'],
  lastMessageBody: 'oi',
  lastMessageAt: '2026-06-23T10:00:00.000Z',
  unreadBy: { me: 2 },
  ...over,
});

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1', conversationId: 'me#1', participants: ['me', '1'],
  senderId: '1', body: 'nova', imageUri: null, sentAt: '2026-06-23T11:00:00.000Z',
  ...over,
});

describe('chatReducers — conversationKey', () => {
  it('é determinístico e independe da ordem', () => {
    expect(conversationKey('me', '1')).toBe('1#me');
    expect(conversationKey('1', 'me')).toBe('1#me');
  });
});

describe('chatReducers — unreadFor / resolveContact', () => {
  it('unreadFor lê o contador do viewer (0 default)', () => {
    expect(unreadFor(conv(), 'me')).toBe(2);
    expect(unreadFor(conv({ unreadBy: {} }), 'me')).toBe(0);
  });
  it('resolveContact pega o participante que não sou eu', () => {
    const r = resolveContact(conv(), 'me');
    expect(r.workerId).toBe('1');
    expect(r.name).toBe('Romulo Cardoso');
    expect(r.subtitle).toBe('Setor Leste');
  });
});

describe('chatReducers — applyMessage', () => {
  it('bump lastMessage, incrementa unread só de quem não enviou, re-ordena', () => {
    const a = conv({ id: 'me#1', lastMessageAt: '2026-06-23T09:00:00.000Z', unreadBy: { me: 0 } });
    const b = conv({ id: 'me#2', participants: ['me', '2'], lastMessageAt: '2026-06-23T10:00:00.000Z' });
    const out = applyMessage([a, b], msg({ conversationId: 'me#1', senderId: '1', body: 'oi', sentAt: '2026-06-23T11:00:00.000Z' }));
    expect(out[0].id).toBe('me#1');
    expect(out[0].lastMessageBody).toBe('oi');
    expect(out[0].unreadBy.me).toBe(1);
    expect(out[0].unreadBy['1']).toBeUndefined();
  });
  it('mensagem só-imagem usa placeholder no preview', () => {
    const out = applyMessage([conv()], msg({ body: '', imageUri: 'x.png' }));
    expect(out[0].lastMessageBody).toContain('Imagem');
  });
  it('sender não incrementa o próprio unread', () => {
    const out = applyMessage([conv({ unreadBy: { me: 0 } })], msg({ senderId: 'me' }));
    expect(out[0].unreadBy.me).toBe(0);
  });
});

describe('chatReducers — markRead / sortByRecent', () => {
  it('markRead zera só o viewer', () => {
    const out = markRead([conv({ unreadBy: { me: 5, '1': 3 } })], 'me#1', 'me');
    expect(out[0].unreadBy.me).toBe(0);
    expect(out[0].unreadBy['1']).toBe(3);
  });
  it('sortByRecent ordena desc por lastMessageAt (null por último)', () => {
    const a = conv({ id: 'a', lastMessageAt: '2026-06-23T09:00:00.000Z' });
    const b = conv({ id: 'b', lastMessageAt: '2026-06-23T12:00:00.000Z' });
    const c = conv({ id: 'c', lastMessageAt: null });
    expect(sortByRecent([a, b, c]).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
});
