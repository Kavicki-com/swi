import {
  conversationKey, unreadFor, resolveContact, sortByRecent, applyMessage, markRead,
  withLaterArrivals, withNewerCards,
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

describe('chatReducers: conversationKey', () => {
  it('é determinístico e independe da ordem', () => {
    expect(conversationKey('me', '1')).toBe('1#me');
    expect(conversationKey('1', 'me')).toBe('1#me');
  });
});

describe('chatReducers: unreadFor / resolveContact', () => {
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

describe('chatReducers: applyMessage', () => {
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

describe('chatReducers: markRead / sortByRecent', () => {
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

// Releitura com o socket de pé: o que o socket entregou enquanto a resposta
// vinha não pode sumir só porque ela chegou atrasada.
describe('chatReducers: withLaterArrivals', () => {
  it('soma ao retrato do servidor a mensagem que chegou depois dele', () => {
    const doServidor = [msg({ id: 'm1', sentAt: '2026-06-23T11:00:00.000Z' })];
    const naTela = [
      msg({ id: 'm1', sentAt: '2026-06-23T11:00:00.000Z' }),
      msg({ id: 'm2', body: 'chegou no meio', sentAt: '2026-06-23T11:05:00.000Z' }),
    ];
    expect(withLaterArrivals(doServidor, naTela).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('o retrato do servidor vale para o que ele já traz (edição incluída)', () => {
    const doServidor = [msg({ id: 'm1', body: 'editada' })];
    const naTela = [msg({ id: 'm1', body: 'original' })];
    expect(withLaterArrivals(doServidor, naTela)).toEqual(doServidor);
  });

  it('mensagem antiga que o servidor não traz mais (apagada) não volta', () => {
    const doServidor = [msg({ id: 'm2', sentAt: '2026-06-23T11:05:00.000Z' })];
    const naTela = [msg({ id: 'm1', sentAt: '2026-06-23T11:00:00.000Z' })];
    expect(withLaterArrivals(doServidor, naTela).map((m) => m.id)).toEqual(['m2']);
  });

  it('retrato vazio fica com tudo o que chegou', () => {
    const naTela = [msg({ id: 'm1' })];
    expect(withLaterArrivals([], naTela)).toEqual(naTela);
  });
});

describe('chatReducers: withNewerCards', () => {
  it('o cartão que o socket atualizou depois do retrato fica', () => {
    const doServidor = [conv({ id: 'a', lastMessageBody: 'velha', lastMessageAt: '2026-06-23T10:00:00.000Z' })];
    const naTela = [conv({ id: 'a', lastMessageBody: 'nova', lastMessageAt: '2026-06-23T11:00:00.000Z' })];
    expect(withNewerCards(doServidor, naTela)[0].lastMessageBody).toBe('nova');
  });

  it('o cartão do servidor vale quando é tão novo quanto o da tela', () => {
    const doServidor = [conv({ id: 'a', unreadBy: { me: 0 } })];
    const naTela = [conv({ id: 'a', unreadBy: { me: 3 } })];
    expect(withNewerCards(doServidor, naTela)[0].unreadBy.me).toBe(0);
  });

  it('conversa nova do servidor entra, e a lista sai ordenada', () => {
    const doServidor = [
      conv({ id: 'a', lastMessageAt: '2026-06-23T10:00:00.000Z' }),
      conv({ id: 'b', lastMessageAt: '2026-06-23T09:00:00.000Z' }),
    ];
    const naTela = [conv({ id: 'b', lastMessageAt: '2026-06-23T12:00:00.000Z' })];
    expect(withNewerCards(doServidor, naTela).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('conversa que só existe na tela não entra: a lista é a do servidor', () => {
    const naTela = [conv({ id: 'z' })];
    expect(withNewerCards([], naTela)).toEqual([]);
  });
});
