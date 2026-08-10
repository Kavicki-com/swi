import {
  sortByRecent, applyNotification, markRead, markAllRead, unreadCount,
} from './notificationReducers';
import type { AppNotification } from './types';

const n = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 'a', title: 'T', body: 'B', domain: 'chat', targetId: null,
  read: false, createdAt: '2026-06-23T10:00:00.000Z', ...over,
});

describe('notificationReducers: sortByRecent', () => {
  it('ordena desc por createdAt (recente primeiro)', () => {
    const a = n({ id: 'a', createdAt: '2026-06-23T09:00:00.000Z' });
    const b = n({ id: 'b', createdAt: '2026-06-23T12:00:00.000Z' });
    const c = n({ id: 'c', createdAt: '2026-06-23T10:00:00.000Z' });
    expect(sortByRecent([a, b, c]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('notificationReducers: applyNotification', () => {
  it('insere uma notificação nova e mantém ordenado', () => {
    const a = n({ id: 'a', createdAt: '2026-06-23T09:00:00.000Z' });
    const fresh = n({ id: 'z', createdAt: '2026-06-23T13:00:00.000Z' });
    const out = applyNotification([a], fresh);
    expect(out.map((x) => x.id)).toEqual(['z', 'a']);
  });
  it('faz update-or-insert (dedupe por id, sem duplicar)', () => {
    const a = n({ id: 'a', read: false });
    const out = applyNotification([a], n({ id: 'a', read: true, createdAt: '2026-06-23T14:00:00.000Z' }));
    expect(out).toHaveLength(1);
    expect(out[0].read).toBe(true);
  });
});

describe('notificationReducers: markRead / markAllRead / unreadCount', () => {
  it('markRead marca só o id alvo', () => {
    const out = markRead([n({ id: 'a', read: false }), n({ id: 'b', read: false })], 'a');
    expect(out.find((x) => x.id === 'a')!.read).toBe(true);
    expect(out.find((x) => x.id === 'b')!.read).toBe(false);
  });
  it('markAllRead marca todas', () => {
    const out = markAllRead([n({ id: 'a', read: false }), n({ id: 'b', read: true })]);
    expect(out.every((x) => x.read)).toBe(true);
  });
  it('unreadCount conta só as não-lidas', () => {
    expect(unreadCount([n({ read: false }), n({ read: false }), n({ read: true })])).toBe(2);
  });
});
