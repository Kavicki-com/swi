import { DATA_BACKEND } from '../../lib/featureFlags';
import type { NotificationBackend } from './types';
import { mockNotificationBackend } from './mockNotificationBackend';
import { amplifyNotificationBackend } from './amplifyNotificationBackend';

export function getNotificationBackend(): NotificationBackend {
  return DATA_BACKEND === 'amplify' ? amplifyNotificationBackend : mockNotificationBackend;
}
