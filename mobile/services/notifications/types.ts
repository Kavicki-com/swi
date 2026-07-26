// Local mirror do model Notification do swi-backend. Siblings isolados → NÃO
// importamos o Schema; após deploy, `ampx generate graphql-client-code` pode
// substituir por tipos gerados. Mirrors services/chat/types.ts. Datas ISO;
// ordenação por comparação lexicográfica (= cronológica).

export type NotificationDomain = 'weather' | 'chat' | 'reports' | 'journey' | 'faq' | 'evacuation';

// 'AppNotification' (não 'Notification') pra não colidir com o global do DOM/RN.
export interface AppNotification {
  id: string;
  title: string;
  body: string;
  domain: NotificationDomain;        // → rota canônica no cliente
  targetId: string | null;           // deep-link a um recurso específico (futuro)
  read: boolean;                     // por-destinatário (1 destinatário)
  createdAt: string;                 // ISO datetime — ordenação recente-primeiro
}

export interface NotificationBackend {
  readonly myId: string;                              // sub do worker logado (mock = 'me')
  listNotifications(): Promise<AppNotification[]>;    // ordenado recente-primeiro
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  registerPushToken(token: string): Promise<void>;   // seam deploy-gated (SNS)
  subscribe(cb: (n: AppNotification) => void): () => void; // feed ao vivo (event bus no mock)
}
