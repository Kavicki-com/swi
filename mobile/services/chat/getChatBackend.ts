import { DATA_BACKEND } from '../../lib/featureFlags';
import type { ChatBackend } from './types';
import { mockChatBackend } from './mockChatBackend';
import { apiChatBackend } from './apiChatBackend';

// Fatia Chat migrada: honra a flag DATA_BACKEND (igual getJourneyBackend).
export function getChatBackend(): ChatBackend {
  return DATA_BACKEND === 'api' ? apiChatBackend : mockChatBackend;
}
