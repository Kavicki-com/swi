import { AUTH_BACKEND } from '../../lib/featureFlags';
import type { ChatBackend } from './types';
import { mockChatBackend } from './mockChatBackend';
import { amplifyChatBackend } from './amplifyChatBackend';

export function getChatBackend(): ChatBackend {
  return AUTH_BACKEND === 'amplify' ? amplifyChatBackend : mockChatBackend;
}
