import { Asset } from 'expo-asset';
import type { ChatBackend, Conversation, Message, Contact } from './types';
import { applyMessage, markRead as markReadReducer, sortByRecent, conversationKey } from './chatReducers';

// Backend demo in-memory pra slice Chat. Mirrors services/journey/mockJourneyBackend.ts:
// um store mutável module-level semeado no import, servido com um tiny async hop
// (`tick`) pra os callers se comportarem como rede real, clonando nas leituras pra
// os consumidores não mutarem os internos. A novidade aqui é um EVENT BUS em
// memória: `subscribe(convId|null, cb)` espelha o canal de tempo real que o
// adaptador de API abre por Socket.IO: `sendMessage` faz `emit(m)` e o
// ChatProvider re-renderiza em real-time. Seed migrado das telas:
//   - DIRECTORY ← USERS array de app/(app)/chat/inbox.tsx (15 contatos).
//   - histórico do Romulo ('1') ← MESSAGES de app/(app)/chat/[userId].tsx.
// `sentAt` são ISO strings sintéticas crescentes (ordenação = lexicográfica).
// `myId = 'me'` (com a API real vem do id do usuário da sessão).

// 8 avatares demo de /assets/avatars/worker-{1..8}.png. Asset.fromModule resolve
// cada require() pra uma uri servida pelo Metro (DS Avatar/ChatUserCard só aceita
// `uri: string`). Mesmo set usado pelas telas de chat.
const AVATARS: string[] = [
  Asset.fromModule(require('../../assets/avatars/worker-1.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-2.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-3.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-4.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-5.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-6.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-7.png')).uri,
  Asset.fromModule(require('../../assets/avatars/worker-8.png')).uri,
];

const MY_ID = 'me';
const ME_NAME = 'Você';
const ME_AVATAR = AVATARS[0];

// ---- Diretório (roster) semeado de USERS em inbox.tsx (15 contatos) ----
// `sector` = o `subtitle` do card; `role` sintetizado (header do user-info).
// avatarUri segue o mapeamento de índice de inbox.tsx (note: '6'→idx6, '7'→idx7,
// '8'→idx5 batem com avatarUri[...] originais; demais por proximidade visual).
type DirSeed = { workerId: string; name: string; sector: string; role: string; avatar: string };

const DIRECTORY: Contact[] = ([
  { workerId: '1', name: 'Romulo Cardoso', sector: 'Setor Leste', role: 'Operador', avatar: AVATARS[0] },
  { workerId: '2', name: 'Ezequiel Almeida', sector: 'Setor Leste', role: 'Operador', avatar: AVATARS[1] },
  { workerId: '3', name: 'Josué Oliveira', sector: 'Setor Leste', role: 'Técnico de Manutenção', avatar: AVATARS[2] },
  { workerId: '4', name: 'Carlos Santos', sector: 'Setor Leste', role: 'Operador', avatar: AVATARS[3] },
  { workerId: '5', name: 'Antonio Carlos Figueira', sector: 'Setor Leste', role: 'Supervisor', avatar: AVATARS[4] },
  { workerId: '6', name: 'Jennifer Gomes', sector: 'Setor Leste', role: 'Analista de Segurança', avatar: AVATARS[6] },
  { workerId: '7', name: 'Adriana Santos Almeida', sector: 'Setor Leste', role: 'Operadora', avatar: AVATARS[7] },
  { workerId: '8', name: 'Carlos Santos', sector: 'Setor Leste', role: 'Operador', avatar: AVATARS[5] },
  { workerId: '9', name: 'Antonio Carlos Figueira', sector: 'Setor Leste', role: 'Operador', avatar: AVATARS[4] },
  { workerId: '10', name: 'Lucas Pereira', sector: 'Setor Oeste', role: 'Técnico de Manutenção', avatar: AVATARS[0] },
  { workerId: '11', name: 'Bruno Silva', sector: 'Setor Norte', role: 'Operador', avatar: AVATARS[1] },
  { workerId: '12', name: 'Maria Rodrigues', sector: 'Setor Sul', role: 'Supervisora', avatar: AVATARS[6] },
  { workerId: '13', name: 'Felipe Costa', sector: 'Setor Leste', role: 'Operador', avatar: AVATARS[2] },
  { workerId: '14', name: 'Rafaela Lima', sector: 'Setor Oeste', role: 'Analista de Segurança', avatar: AVATARS[7] },
  { workerId: '15', name: 'Diogo Ramos', sector: 'Setor Norte', role: 'Operador', avatar: AVATARS[3] },
] as DirSeed[]).map(({ avatar, ...c }) => ({ ...c, avatarUri: avatar }));

function dirById(workerId: string): Contact | undefined {
  return DIRECTORY.find((c) => c.workerId === workerId);
}

// ---- Seed das conversas + mensagens ----
// Datas base por conversa (decrescem entre conversas pra ordem de recência ser
// definida); cada mensagem dentro da conversa incrementa o relógio via `time`.
let seqCounter = 0;
function nextId(): string {
  seqCounter += 1;
  return `m${seqCounter}`;
}

type ThreadSeed = {
  contactId: string;
  unread: number;        // unreadBy.me semeado (badge do inbox)
  baseDay: string;       // YYYY-MM-DD; horas vêm dos textos abaixo
  texts: { from: 'me' | 'them'; body: string; time: string }[];
};

// Romulo ('1') ganha o histórico completo migrado de MESSAGES em [userId].tsx.
// Os outros 7 contatos ('2'..'8') ganham 1–3 mensagens curtas. `baseDay` difere
// por conversa pra garantir lastMessageAt distintos (Romulo o mais recente).
const THREADS: ThreadSeed[] = [
  {
    contactId: '1',
    unread: 10,
    baseDay: '2026-06-23',
    texts: [
      { from: 'them', body: 'Vamos precisar alinhar com a equipe de transporte sobre os horários.', time: '13:42' },
      { from: 'me', body: 'Combinado. Já enviei a planilha para o pessoal do operacional.', time: '13:50' },
      { from: 'them', body: 'Perfeito. Obrigado pelo retorno rápido.', time: '13:55' },
      { from: 'them', body: 'Ainda não recebemos atualizações recentes do setor de segurança.', time: '14:20' },
      { from: 'them', body: 'Bom dia! Alguma novidade sobre a detonação de explosivos na área 7?', time: '14:25' },
      { from: 'me', body: 'Olá! Sim, tudo ok por aqui. Precisamos de mais explosivos para a próxima semana.', time: '14:57' },
      { from: 'them', body: 'Os especialistas estão agendando uma reunião para discutir os próximos passos.', time: '15:10' },
      { from: 'them', body: 'É recomendado manter a área isolada até segunda ordem das autoridades competentes.', time: '15:15' },
    ],
  },
  {
    contactId: '2',
    unread: 2,
    baseDay: '2026-06-22',
    texts: [
      { from: 'them', body: 'Conseguimos finalizar a inspeção do turno da manhã.', time: '09:10' },
      { from: 'me', body: 'Ótimo, registra no relatório por favor.', time: '09:18' },
      { from: 'them', body: 'Já registrado. Algum ponto de atenção?', time: '09:30' },
    ],
  },
  {
    contactId: '3',
    unread: 2,
    baseDay: '2026-06-21',
    texts: [
      { from: 'them', body: 'A bomba hidráulica voltou a apresentar ruído.', time: '11:05' },
      { from: 'them', body: 'Vou abrir uma OS de manutenção preventiva.', time: '11:12' },
    ],
  },
  {
    contactId: '4',
    unread: 0,
    baseDay: '2026-06-20',
    texts: [
      { from: 'me', body: 'Carlos, consegue cobrir o turno da tarde amanhã?', time: '16:40' },
      { from: 'them', body: 'Consigo sim, sem problema.', time: '16:52' },
    ],
  },
  {
    contactId: '5',
    unread: 0,
    baseDay: '2026-06-19',
    texts: [
      { from: 'them', body: 'Reunião de segurança confirmada para sexta às 14h.', time: '10:00' },
    ],
  },
  {
    contactId: '6',
    unread: 0,
    baseDay: '2026-06-18',
    texts: [
      { from: 'them', body: 'Os EPIs novos chegaram no almoxarifado.', time: '08:30' },
      { from: 'me', body: 'Show, vou retirar os do nosso setor.', time: '08:45' },
    ],
  },
  {
    contactId: '7',
    unread: 0,
    baseDay: '2026-06-17',
    texts: [
      { from: 'me', body: 'Adriana, o checklist da área 3 está pronto?', time: '13:20' },
      { from: 'them', body: 'Está, enviei por e-mail também.', time: '13:35' },
      { from: 'them', body: 'Qualquer coisa me avisa.', time: '13:36' },
    ],
  },
  {
    contactId: '8',
    unread: 0,
    baseDay: '2026-06-16',
    texts: [
      { from: 'them', body: 'Fechamos o reparo do compressor.', time: '17:05' },
    ],
  },
];

function isoFor(baseDay: string, time: string): string {
  // "YYYY-MM-DD" + "HH:MM" → ISO datetime UTC.
  return new Date(`${baseDay}T${time}:00.000Z`).toISOString();
}

function buildSeed(): { conversations: Conversation[]; messages: Message[] } {
  const built: Conversation[] = [];
  const msgs: Message[] = [];

  for (const thread of THREADS) {
    const contact = dirById(thread.contactId);
    if (!contact) continue;
    const id = conversationKey(MY_ID, contact.workerId);
    const participants = [MY_ID, contact.workerId];

    for (const t of thread.texts) {
      msgs.push({
        id: nextId(),
        conversationId: id,
        participants,
        senderId: t.from === 'me' ? MY_ID : contact.workerId,
        body: t.body,
        imageUri: null,
        sentAt: isoFor(thread.baseDay, t.time),
      });
    }

    const last = thread.texts[thread.texts.length - 1];
    built.push({
      id,
      participants,
      participantNames: [ME_NAME, contact.name],
      participantSubtitles: ['', contact.sector],
      participantAvatars: [ME_AVATAR, contact.avatarUri],
      lastMessageBody: last.body,
      lastMessageAt: isoFor(thread.baseDay, last.time),
      unreadBy: thread.unread > 0 ? { [MY_ID]: thread.unread } : {},
    });
  }

  return { conversations: built, messages: msgs };
}

// ---- Store mutável module-level ----

const seed = buildSeed();
let conversations: Conversation[] = seed.conversations;
const messages: Message[] = seed.messages;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---- Event bus in-memory (espelha o canal Socket.IO do adaptador de API) ----
type Listener = (m: Message) => void;
const listeners = new Map<string, Set<Listener>>(); // key = convId | '*'

function emit(m: Message) {
  listeners.get(m.conversationId)?.forEach((cb) => cb(m));
  listeners.get('*')?.forEach((cb) => cb(m));
}

// Clone defensivo: copia arrays e o map unreadBy pra os callers não mutarem o store.
function cloneConversation(c: Conversation): Conversation {
  return {
    ...c,
    participants: [...c.participants],
    participantNames: [...c.participantNames],
    participantSubtitles: [...c.participantSubtitles],
    participantAvatars: [...c.participantAvatars],
    unreadBy: { ...c.unreadBy },
  };
}

// Cria a conversa lazy a partir do diretório quando sendMessage aponta pra um
// id determinístico ainda sem conversa (ex.: primeiro "Novo Chat" com um contato).
function createLazy(convId: string): Conversation {
  const otherId = convId.split('#').find((p) => p !== MY_ID) ?? '';
  const contact = dirById(otherId);
  const conv: Conversation = {
    id: convId,
    participants: [MY_ID, otherId],
    participantNames: [ME_NAME, contact?.name ?? ''],
    participantSubtitles: ['', contact?.sector ?? ''],
    participantAvatars: [ME_AVATAR, contact?.avatarUri ?? ''],
    lastMessageBody: '',
    lastMessageAt: null,
    unreadBy: {},
  };
  conversations = [...conversations, conv];
  return conv;
}

export const mockChatBackend: ChatBackend = {
  myId: MY_ID,

  async listConversations() {
    await tick();
    return sortByRecent(conversations).map(cloneConversation);
  },

  async listMessages(conversationId) {
    await tick();
    return messages.filter((m) => m.conversationId === conversationId).map((m) => ({ ...m }));
  },

  async listDirectory() {
    await tick();
    return DIRECTORY.map((d) => ({ ...d }));
  },

  async sendMessage(conversationId, body, imageUri) {
    await tick();
    let conv = conversations.find((c) => c.id === conversationId);
    if (!conv) conv = createLazy(conversationId);

    const m: Message = {
      id: nextId(),
      conversationId,
      participants: [...conv.participants],
      senderId: MY_ID,
      body,
      imageUri: imageUri ?? null,
      sentAt: new Date().toISOString(),
    };
    messages.push(m);
    conversations = applyMessage(conversations, m);
    emit(m);
    return { ...m };
  },

  async markRead(conversationId) {
    await tick();
    conversations = markReadReducer(conversations, conversationId, MY_ID);
  },

  subscribe(conversationId, cb) {
    const key = conversationId ?? '*';
    let set = listeners.get(key);
    if (!set) {
      set = new Set<Listener>();
      listeners.set(key, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  },
};
