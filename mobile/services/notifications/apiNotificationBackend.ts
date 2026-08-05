import * as SecureStore from 'expo-secure-store';
import { io, type Socket } from 'socket.io-client';
import type { AppNotification, NotificationBackend } from './types';
import { apiRequest } from '../api/http';
import { getUserId } from '../api/session';
import { getApiUrl } from '../auth/apiConfig';

const TOKEN_KEY = 'swi.auth.token';

// Backend devolve o shape mobile pronto (ISO no createdAt). `subscribe` troca o
// event-bus do mock por um socket.io real (evento 'notification'). `registerPushToken`
// fica no-op seam — a entrega de push do SO é deploy-gated (FCM/APNs + expo-notifications).
export const apiNotificationBackend: NotificationBackend = {
  get myId() { return getUserId(); },

  listNotifications() { return apiRequest<AppNotification[]>('/notifications', { auth: true }); },

  async markRead(id) {
    await apiRequest<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', auth: true });
  },

  async markAllRead() {
    await apiRequest<void>('/notifications/read-all', { method: 'POST', auth: true });
  },

  async registerPushToken() {
    // no-op seam: entrega de push do SO é deploy-gated (FCM/APNs + device token).
  },

  subscribe(cb) {
    let socket: Socket | null = null;
    let closed = false;
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (closed) return;
      // polling primeiro, com upgrade pra WS: espelho do chat e do painel. O
      // handshake WS puro falha em proxies que não repassam o upgrade, e sem
      // o fallback NENHUMA notificação ao vivo chegava, inclusive "nova
      // tarefa atribuída".
      socket = io(getApiUrl(), {
        auth: { token },
        transports: ['polling', 'websocket'],
      });
      socket.on('notification', (n: AppNotification) => { cb(n); });
    })();
    return () => { closed = true; socket?.close(); };
  },
};
