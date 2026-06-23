import type { AppNotification, NotificationBackend, NotificationDomain } from './types';
import {
  sortByRecent, applyNotification,
  markRead as markReadReducer, markAllRead as markAllReadReducer,
} from './notificationReducers';

// Backend demo in-memory pra slice Notificações. Mirrors mockChatBackend.ts: store
// mutável module-level semeado no import, servido com um tiny async hop (`tick`) e
// clone defensivo nas leituras. Um EVENT BUS de canal único (`subscribe(cb)`)
// simula `client.models.Notification.onCreate` do AppSync. NÃO há gerador de push
// sintético no app rodando — chegadas reais vêm do servidor (SNS/AppSync) no
// deploy; o bus é exercitado nos testes via `__pushForTest`. `myId = 'me'`.
//
// Seed migrado do array estático de app/(app)/notifications.tsx (12 itens): cada
// item recebe um `domain` derivado do href original + um createdAt ISO sintético
// decrescente (1º = mais recente). Mix de read/unread realista (3 não-lidas).

const MY_ID = 'me';
const BASE = '2026-06-23T15:00:00.000Z'; // relógio base fixo → seed determinístico
function isoMinusMinutes(minutes: number): string {
  return new Date(new Date(BASE).getTime() - minutes * 60_000).toISOString();
}

type Seed = {
  id: string; title: string; body: string;
  domain: NotificationDomain; targetId?: string; read: boolean; minutesAgo: number;
};

const SEED: Seed[] = [
  { id: 'alerta-meteorologico', title: 'Alerta Meteorológico', body: 'Aviso de tempestades fortes previstas para as próximas 24 horas, tome precauções necessárias.', domain: 'weather', read: false, minutesAgo: 5 },
  { id: 'atividade-colaborador', title: 'Atividade de Colaborador', body: 'Ana atualizou o status da manutenção preventiva no setor de produção.', domain: 'chat', read: false, minutesAgo: 30 },
  { id: 'feedback-recebido', title: 'Feedback Recebido', body: 'Equipe reportou melhorias significativas após implementação das novas diretrizes.', domain: 'chat', read: false, minutesAgo: 90 },
  { id: 'novo-relatorio', title: 'Novo Relatório Atribuído', body: 'Relatório de segurança do setor 5 foi designado para sua análise.', domain: 'reports', read: true, minutesAgo: 180 },
  { id: 'relatorio-qualidade', title: 'Relatório de Qualidade', body: 'Análise dos indicadores de qualidade do último trimestre disponível para revisão.', domain: 'reports', read: true, minutesAgo: 240 },
  { id: 'treinamento', title: 'Notificação de Treinamento', body: 'Curso sobre normas ambientais será oferecido na próxima quarta-feira.', domain: 'journey', read: true, minutesAgo: 300 },
  { id: 'nova-tarefa', title: 'Nova Tarefa Atribuída', body: 'Realizar auditoria dos processos de armazenamento até o final da semana.', domain: 'journey', read: true, minutesAgo: 360 },
  { id: 'nova-inspecao', title: 'Nova Inspeção Programada', body: 'Agendada inspeção de segurança elétrica para a próxima segunda-feira.', domain: 'journey', read: true, minutesAgo: 420 },
  { id: 'cronograma', title: 'Mudança no Cronograma', body: 'Prazo para envio de relatórios técnicos foi estendido em duas semanas.', domain: 'journey', read: true, minutesAgo: 480 },
  { id: 'comentario-relatorio', title: 'Comentário em Relatório', body: `Carlos comentou: 'Verificar a conformidade dos equipamentos com a norma ISO 9001.'`, domain: 'chat', read: true, minutesAgo: 540 },
  { id: 'atualizacao-procedimento', title: 'Atualização de Procedimento', body: 'Procedimento de emergência revisado e disponível para consulta.', domain: 'faq', read: true, minutesAgo: 600 },
  { id: 'novo-comentario', title: 'Novo Comentário', body: `João observou: 'Necessário reforçar monitoramento durante turnos noturnos.'`, domain: 'chat', read: true, minutesAgo: 660 },
];

function buildSeed(): AppNotification[] {
  return SEED.map((s) => ({
    id: s.id, title: s.title, body: s.body, domain: s.domain,
    targetId: s.targetId ?? null, read: s.read, createdAt: isoMinusMinutes(s.minutesAgo),
  }));
}

// ---- Store mutável module-level ----
let notifications: AppNotification[] = sortByRecent(buildSeed());
let lastToken: string | null = null;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---- Event bus in-memory (simula AppSync onCreate, canal único por-usuário) ----
type Listener = (n: AppNotification) => void;
const listeners = new Set<Listener>();
function emit(n: AppNotification) { listeners.forEach((cb) => cb(n)); }

export const mockNotificationBackend: NotificationBackend = {
  myId: MY_ID,

  async listNotifications() {
    await tick();
    return sortByRecent(notifications).map((n) => ({ ...n }));
  },

  async markRead(id) {
    await tick();
    notifications = markReadReducer(notifications, id);
  },

  async markAllRead() {
    await tick();
    notifications = markAllReadReducer(notifications);
  },

  async registerPushToken(token) {
    await tick();
    lastToken = token; // no-op de entrega; no deploy → SNS createPlatformEndpoint
  },

  subscribe(cb) {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};

// Test-only: simula um push do servidor (o app NUNCA chama isto — chegadas reais
// vêm do AppSync/SNS no deploy). Empurra pro store + emite no bus.
export function __pushForTest(n: AppNotification): void {
  notifications = applyNotification(notifications, n);
  emit(n);
}
export function __lastTokenForTest(): string | null {
  return lastToken;
}
