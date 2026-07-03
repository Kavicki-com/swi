import { DATA_BACKEND } from '../../lib/featureFlags';
import type { NotificationBackend } from './types';
import { mockNotificationBackend } from './mockNotificationBackend';
import { apiNotificationBackend } from './apiNotificationBackend';

// Fatia Notificações migrada: honra a flag DATA_BACKEND (igual getChatBackend).
export function getNotificationBackend(): NotificationBackend {
  return DATA_BACKEND === 'api' ? apiNotificationBackend : mockNotificationBackend;
}
