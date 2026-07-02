import type { ChatBackend } from './types';
import { mockChatBackend } from './mockChatBackend';

// Pinado em mock até a fatia Chat ligar o apiChatBackend
// (rodada: docs/plans/2026-07-02-swi-backend-dominios-nao-saude-design.md).
export function getChatBackend(): ChatBackend {
  return mockChatBackend;
}
