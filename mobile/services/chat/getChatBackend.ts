import { DATA_BACKEND } from '../../lib/featureFlags';
import type { ChatBackend } from './types';
import { mockChatBackend } from './mockChatBackend';
import { amplifyChatBackend } from './amplifyChatBackend';

export function getChatBackend(): ChatBackend {
  return DATA_BACKEND === 'amplify' ? amplifyChatBackend : mockChatBackend;
}
