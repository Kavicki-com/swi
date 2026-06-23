import { generateClient } from 'aws-amplify/data';
import type { AppNotification, NotificationBackend } from './types';

const client = generateClient();

const NOT_READY = (op: string) =>
  new Error(`amplifyNotificationBackend.${op}: deploy-gated (sem conta AWS)`);

export const amplifyNotificationBackend: NotificationBackend = {
  myId: '', // virá do auth session (Cognito sub) no deploy
  async listNotifications(): Promise<AppNotification[]> { void client; throw NOT_READY('listNotifications'); },
  async markRead(id: string): Promise<void> { void id; throw NOT_READY('markRead'); },
  async markAllRead(): Promise<void> { throw NOT_READY('markAllRead'); },
  async registerPushToken(token: string): Promise<void> { void token; throw NOT_READY('registerPushToken'); },
  subscribe(cb: (n: AppNotification) => void): () => void {
    // Deploy: client.models.Notification.onCreate({ filter: { workerId: { eq: myId } } }).subscribe({ next: cb })
    void cb;
    return () => {};
  },
};
