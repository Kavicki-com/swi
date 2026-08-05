import * as SecureStore from 'expo-secure-store';
import { io, type Socket } from 'socket.io-client';
import type { ChatBackend, Conversation, Message, Contact } from './types';
import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';
import { getUserId } from '../api/session';
import { getApiUrl } from '../auth/apiConfig';

const TOKEN_KEY = 'swi.auth.token';
// Ids de conversa contêm '#' (a#b): em URL isso é fragmento — precisa encodar.
const conv = (id: string) => `/chat/conversations/${encodeURIComponent(id)}`;

// Backend já devolve o shape mobile pronto (URLs presigned, ISO) → sem fromApi.
// `subscribe` troca o event-bus in-memory do mock por um socket.io real; o
// ChatProvider só usa subscribe(null), mas o filtro por convId é honrado.
export const apiChatBackend: ChatBackend = {
  get myId() { return getUserId(); },

  listConversations() { return apiRequest<Conversation[]>('/chat/conversations', { auth: true }); },
  listMessages(conversationId) { return apiRequest<Message[]>(`${conv(conversationId)}/messages`, { auth: true }); },
  listDirectory() { return apiRequest<Contact[]>('/chat/directory', { auth: true }); },

  async sendMessage(conversationId, body, imageUri) {
    const imageKey = imageUri ? await uploadImage(imageUri, 'chat') : undefined;
    const payload = imageKey ? { body, imageKey } : { body };
    return apiRequest<Message>(`${conv(conversationId)}/messages`, { method: 'POST', body: payload, auth: true });
  },

  async markRead(conversationId) {
    await apiRequest<void>(`${conv(conversationId)}/read`, { method: 'POST', auth: true });
  },

  subscribe(conversationId, cb) {
    let socket: Socket | null = null;
    let closed = false;
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (closed) return;
      // polling primeiro, com upgrade pra WS: o handshake WS puro falha em
      // proxies que nao repassam o upgrade, e cair pra polling mantem o
      // realtime funcionando em vez de morrer calado.
      socket = io(getApiUrl(), {
        auth: { token },
        transports: ['polling', 'websocket'],
      });
      socket.on('message', (m: Message) => {
        if (conversationId === null || m.conversationId === conversationId) cb(m);
      });
    })();
    return () => { closed = true; socket?.close(); };
  },
};
