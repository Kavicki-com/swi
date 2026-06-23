import { mockNotificationBackend, __pushForTest, __lastTokenForTest } from './mockNotificationBackend';
import type { AppNotification } from './types';

describe('mockNotificationBackend — seed + list', () => {
  it('lista as 12 notificações semeadas, ordenadas recente-primeiro', async () => {
    const list = await mockNotificationBackend.listNotifications();
    expect(list).toHaveLength(12);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].createdAt >= list[i].createdAt).toBe(true);
    }
  });
  it('o item mais recente é o alerta meteorológico (domain weather, não-lido)', async () => {
    const [first] = await mockNotificationBackend.listNotifications();
    expect(first.id).toBe('alerta-meteorologico');
    expect(first.domain).toBe('weather');
    expect(first.read).toBe(false);
  });
});

describe('mockNotificationBackend — markRead / markAllRead persistem', () => {
  it('markRead persiste no store', async () => {
    await mockNotificationBackend.markRead('alerta-meteorologico');
    const list = await mockNotificationBackend.listNotifications();
    expect(list.find((n) => n.id === 'alerta-meteorologico')!.read).toBe(true);
  });
  it('markAllRead zera todas', async () => {
    await mockNotificationBackend.markAllRead();
    const list = await mockNotificationBackend.listNotifications();
    expect(list.every((n) => n.read)).toBe(true);
  });
});

describe('mockNotificationBackend — subscribe (event bus) + push token', () => {
  it('subscribe recebe um push simulado e unsubscribe para de receber', () => {
    const received: AppNotification[] = [];
    const unsub = mockNotificationBackend.subscribe((n) => received.push(n));
    const fresh: AppNotification = {
      id: 'srv-1', title: 'Nova', body: 'do servidor', domain: 'reports',
      targetId: null, read: false, createdAt: '2026-06-23T23:00:00.000Z',
    };
    __pushForTest(fresh);
    expect(received.map((n) => n.id)).toEqual(['srv-1']);
    unsub();
    __pushForTest({ ...fresh, id: 'srv-2' });
    expect(received.map((n) => n.id)).toEqual(['srv-1']); // não recebeu o 2º
  });
  it('registerPushToken é no-op (armazena, não lança)', async () => {
    await expect(mockNotificationBackend.registerPushToken('tok-123')).resolves.toBeUndefined();
    expect(__lastTokenForTest()).toBe('tok-123');
  });
});
