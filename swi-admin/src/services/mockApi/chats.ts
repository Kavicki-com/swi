// src/services/mockApi/chats.ts
// Mock chat contacts for the /chat inbox screen (Figma 103:9924 + 102:8997).
// Names extracted from the Figma frame; avatars rotated from the existing
// chat-* PNGs (we have 4 photos for 7 contacts so worker-* fills the gap).
//
// Each contact also carries demo conversation history + profile metadata so
// that selecting a contact can render the "active" state (Figma 102:8997)
// without an extra API call.
import { sleep } from './sleep'
import type { MockResponse } from './types'
import chatEzequiel from '@/assets/avatars/chat-ezequiel.png'
import chatRomulo from '@/assets/avatars/chat-romulo.png'
import chatJulio from '@/assets/avatars/chat-julio.png'
import chatJennifer from '@/assets/avatars/chat-jennifer.png'
import workerA from '@/assets/avatars/worker-a.png'
import workerB from '@/assets/avatars/worker-b.png'
import workerC from '@/assets/avatars/worker-c.png'

export type ChatMessage = {
  id: string
  text: string
  // 'them' = received bubble (left, primary-light border, avatar on left).
  // 'me'   = sent bubble (right, secondary-light border, avatar on right).
  sender: 'me' | 'them'
  time: string
}

export type ChatContact = {
  id: string
  name: string
  sector: string
  avatarUri: string
  unreadCount?: number
  // Profile fields used by the right-column info panel when this contact is
  // the active chat (Figma 102:8997 right column 102:9672).
  role?: string
  subtitle?: string
  gender?: 'male' | 'female'
  age?: number
  bloodType?: string
  allergies?: string
  fatigueRemaining?: string
  // Pre-baked conversation history. The same DEMO_MESSAGES array is reused
  // across contacts in the demo seed — production would fetch per contact.
  messages?: ReadonlyArray<ChatMessage>
}

// Conversation extracted verbatim from Figma 102:8997 — five bubbles split by
// "Hoje - 21/03/2026" date separator. Reused for every contact in the demo
// so any selection renders a populated chat history.
const DEMO_MESSAGES: ReadonlyArray<ChatMessage> = [
  {
    id: 'm-01',
    text: 'Ainda não recebemos atualizações recentes do setor de segurança.',
    sender: 'them',
    time: '14:25',
  },
  {
    id: 'm-02',
    text: 'Olá! Sim, tudo ok por aqui. Precisamos de mais explosivos para a próxima semana.',
    sender: 'me',
    time: '14:57',
  },
  {
    id: 'm-03',
    text: 'Bom dia! Alguma novidade sobre a detonação de explosivos na área 7?',
    sender: 'them',
    time: '14:25',
  },
  {
    id: 'm-04',
    text: 'Olá! Sim, tudo ok por aqui. Precisamos de mais explosivos para a próxima semana.',
    sender: 'me',
    time: '14:57',
  },
  {
    id: 'm-05',
    text: 'Os especialistas estão agendando uma reunião para discutir os próximos passos.',
    sender: 'them',
    time: '14:25',
  },
  {
    id: 'm-06',
    text: 'É recomendado manter a área isolada até segunda ordem das autoridades competentes.',
    sender: 'them',
    time: '14:25',
  },
]

// Profile defaults — every contact gets the same demo profile in the right
// panel so any selection renders the same complete state. Production would
// pull from /employees/:id.
const DEMO_PROFILE = {
  role: 'Operador de escavadeira',
  subtitle: 'Maquinário pesado',
  gender: 'male' as const,
  age: 26,
  bloodType: 'O+',
  allergies: 'Nenhuma',
  fatigueRemaining: '1:45:12 h',
}

const CHATS_SEED: ReadonlyArray<ChatContact> = [
  {
    id: 'chat-romulo',
    name: 'Romulo Cardoso',
    sector: 'Setor Leste',
    avatarUri: chatRomulo,
    unreadCount: 10,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-ezequiel',
    name: 'Ezequiel Almeida',
    sector: 'Setor Leste',
    avatarUri: chatEzequiel,
    unreadCount: 2,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-josue',
    name: 'Josué Oliveira',
    sector: 'Setor Leste',
    avatarUri: chatJulio,
    unreadCount: 2,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-carlos',
    name: 'Carlos Santos',
    sector: 'Setor Leste',
    avatarUri: workerA,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-antonio',
    name: 'Antonio Carlos Figueira',
    sector: 'Setor Leste',
    avatarUri: workerB,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-jennifer',
    name: 'Jennifer Gomes',
    sector: 'Setor Leste',
    avatarUri: chatJennifer,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-adriana',
    name: 'Adriana Santos Almeida',
    sector: 'Setor Leste',
    avatarUri: workerC,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
]

export const chatsApi = {
  async list(): Promise<MockResponse<ReadonlyArray<ChatContact>>> {
    await sleep(80)
    return { data: CHATS_SEED, error: null }
  },
}
