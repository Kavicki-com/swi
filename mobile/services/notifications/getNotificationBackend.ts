import type { NotificationBackend } from './types';
import { mockNotificationBackend } from './mockNotificationBackend';

// Pinado em mock até a fatia Notificações ligar o apiNotificationBackend
// (rodada: docs/plans/2026-07-02-swi-backend-dominios-nao-saude-design.md).
export function getNotificationBackend(): NotificationBackend {
  return mockNotificationBackend;
}
