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

// Conversation extracted from Figma 102:8997 — five bubbles split by the
// "Hoje - 21/03/2026" date separator. Padded with extra back-and-forth so
// the demo chat overflows the visible chat-box and the user can actually
// scroll up to "older" messages. Reused for every contact in the demo.
const DEMO_MESSAGES: ReadonlyArray<ChatMessage> = [
  {
    id: 'm-00a',
    text: 'Bom dia, Romulo. Verifiquei a planilha de checagem da área 6 — tudo dentro do esperado.',
    sender: 'them',
    time: '08:14',
  },
  {
    id: 'm-00b',
    text: 'Recebido. Vou repassar pro turno da tarde antes do briefing.',
    sender: 'me',
    time: '08:21',
  },
  {
    id: 'm-00c',
    text: 'Lembrete: relatório de exposição química do trimestre vence sexta. Já submetemos a análise da Mina Norte.',
    sender: 'them',
    time: '09:02',
  },
  {
    id: 'm-00d',
    text: 'Perfeito. Anexa por favor a versão revisada quando subir, quero conferir antes de assinar.',
    sender: 'me',
    time: '09:05',
  },
  {
    id: 'm-00e',
    text: 'O João comentou que o sensor de pressão da escavadeira K35 zerou duas vezes ontem. Vou agendar manutenção preventiva.',
    sender: 'them',
    time: '10:11',
  },
  {
    id: 'm-00f',
    text: 'Ok, prioriza. Se precisar parar a operação por algumas horas tudo bem, melhor que esperar quebrar em campo.',
    sender: 'me',
    time: '10:14',
  },
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
  {
    id: 'm-07',
    text: 'Confirmo. Estou enviando a equipe de demolição controlada às 16h pra avaliar.',
    sender: 'me',
    time: '14:30',
  },
  {
    id: 'm-08',
    text: 'A Defesa Civil pediu pra evacuarmos os contêineres de combustível por precaução.',
    sender: 'them',
    time: '14:42',
  },
  {
    id: 'm-09',
    text: 'Já estamos movendo. Previsão de finalizar em 40 minutos. Te aviso quando estiver liberado.',
    sender: 'me',
    time: '14:48',
  },
  {
    id: 'm-10',
    text: 'Beleza, fico no aguardo. Avisa também o pessoal do refeitório que ficaram em dúvida sobre o horário do almoço.',
    sender: 'them',
    time: '14:50',
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
    sector: 'Setor Norte',
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
    sector: 'Setor Sul',
    avatarUri: chatJulio,
    unreadCount: 2,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-carlos',
    name: 'Carlos Santos',
    sector: 'Setor Oeste',
    avatarUri: workerA,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-antonio',
    name: 'Antonio Carlos Figueira',
    sector: 'Setor Leste',
    avatarUri: workerB,
    unreadCount: 4,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-jennifer',
    name: 'Jennifer Gomes',
    sector: 'Setor Norte',
    avatarUri: chatJennifer,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-adriana',
    name: 'Adriana Santos Almeida',
    sector: 'Setor Sul',
    avatarUri: workerC,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-rafael',
    name: 'Rafael Andrade',
    sector: 'Setor Norte',
    avatarUri: chatRomulo,
    unreadCount: 1,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-mariana',
    name: 'Mariana Vieira',
    sector: 'Setor Norte',
    avatarUri: chatJennifer,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-lucas',
    name: 'Lucas Pereira Lima',
    sector: 'Setor Sul',
    avatarUri: workerA,
    unreadCount: 5,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-beatriz',
    name: 'Beatriz Ramos',
    sector: 'Setor Oeste',
    avatarUri: chatEzequiel,
    ...DEMO_PROFILE,
    messages: DEMO_MESSAGES,
  },
  {
    id: 'chat-tiago',
    name: 'Tiago Mendes',
    sector: 'Setor Oeste',
    avatarUri: workerB,
    unreadCount: 2,
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
