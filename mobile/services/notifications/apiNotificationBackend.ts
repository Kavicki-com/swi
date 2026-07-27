import * as SecureStore from 'expo-secure-store';
import { io, type Socket } from 'socket.io-client';
import type { AppNotification, NotificationBackend } from './types';
import { apiRequest } from '../api/http';
import { getUserId } from '../api/session';
import { API_URL } from '../auth/apiConfig';

const TOKEN_KEY = 'swi.auth.token';

// Backend devolve o shape mobile pronto (ISO no createdAt). `subscribe` troca o
// event-bus do mock por um socket.io real (evento 'notification'). `registerPushToken`
// fica no-op seam — a entrega de push do SO é deploy-gated (SNS/FCM/APNs + expo-notifications).
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
    // no-op seam: entrega de push do SO é deploy-gated (SNS/FCM/APNs + device token).
  },

  subscribe(cb) {
    let socket: Socket | null = null;
    let closed = false;
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (closed) return;
      // polling primeiro: espelho do chat e do painel — o handshake WS puro
      // morre na interstitial do ngrok free no QA remoto, e sem isto NENHUMA
      // notificação ao vivo chegava pelo túnel (inclusive "nova tarefa
      // atribuída"). Polling é XHR e carrega o header de skip; sobe pra WS
      // quando o caminho deixa.
      socket = io(API_URL, {
        auth: { token },
        transports: ['polling', 'websocket'],
        transportOptions: {
          polling: { extraHeaders: { 'ngrok-skip-browser-warning': 'true' } },
        },
      });
      socket.on('notification', (n: AppNotification) => { cb(n); });
    })();
    return () => { closed = true; socket?.close(); };
  },
};
