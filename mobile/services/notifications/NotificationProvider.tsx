import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import type { AppNotification } from './types';
import { getNotificationBackend } from './getNotificationBackend';
import {
  applyNotification,
  markRead as markReadReducer,
  unreadCount as unreadCountReducer,
} from './notificationReducers';
import { useOnReconnect } from '../realtime/useConnection';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

// O que mudou na tela depois de uma leitura da lista sair: a resposta traz o
// servidor de quando ele foi lido, e isto é refeito por cima dela. "Lidas"
// guarda os ids, e não "todas": uma notificação que chegou depois do toque em
// "marcar todas" continua não lida.
type LocalChange =
  | { type: 'arrived'; notification: AppNotification }
  | { type: 'read'; ids: string[] };

const applyChange = (ns: AppNotification[], change: LocalChange): AppNotification[] =>
  change.type === 'arrived'
    ? applyNotification(ns, change.notification)
    : change.ids.reduce(markReadReducer, ns);

interface NotificationContextValue {
  myId: string;
  loadStatus: LoadStatus;
  notifications: AppNotification[];
  unreadCount: number;
  load: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getNotificationBackend(), []);
  const myId = backend.myId;
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const latest = useRef(notifications);
  latest.current = notifications;

  // `issued` conta as leituras que saíram; `applied` é a última que valeu.
  // Resposta de leitura mais antiga que a aplicada é descartada: ela traria a
  // lista de antes. Cada mudança local guarda quantas leituras já tinham saído,
  // e o "lida" guarda também se o pedido ao servidor ainda está indo: até ele
  // voltar, uma leitura feita depois do toque pode ainda não o trazer.
  const issued = useRef(0);
  const applied = useRef(0);
  const changes = useRef<{ after: number; change: LocalChange; sending: boolean }[]>([]);

  const change = useCallback((next: LocalChange) => {
    const entry = { after: issued.current, change: next, sending: next.type === 'read' };
    changes.current.push(entry);
    setNotifications((prev) => applyChange(prev, next));
    return entry;
  }, []);

  // `silent`: releitura de fundo (conexão que volta, volta ao primeiro plano)
  // não passa por "carregando" e, se falhar, deixa a tela como está.
  const read = useCallback((silent: boolean) => {
    const seq = (issued.current += 1);
    if (!silent) setLoadStatus('loading');
    return backend.listNotifications().then(
      (ns) => {
        if (seq < applied.current) return;
        applied.current = seq;
        // Só o que mudou depois de esta leitura sair, e o "lida" que o servidor
        // ainda não confirmou, podem faltar nela.
        changes.current = changes.current.filter((c) => c.after >= seq || c.sending);
        const merged = changes.current.reduce((acc, c) => applyChange(acc, c.change), ns);
        setNotifications(merged);
        setLoadStatus(merged.length ? 'ready' : 'empty');
      },
      () => {
        if (seq < applied.current || silent) return;
        setLoadStatus('error');
      },
    );
  }, [backend]);

  const load = useCallback(() => read(false), [read]);
  const refresh = useCallback(() => read(true), [read]);

  useEffect(() => { load(); }, [load]);

  // Feed ao vivo: o servidor (event bus do mock, Socket.IO na API real) empurra novas
  // notificações; o reducer faz update-or-insert e re-ordena.
  useEffect(() => {
    const unsub = backend.subscribe((n) => change({ type: 'arrived', notification: n }));
    return unsub;
  }, [backend, change]);

  // O que chegou pelo socket enquanto ele estava caído, ou com o app parado,
  // se perdeu: a lista é relida. A evacuação chega só por aqui.
  useOnReconnect(() => { void refresh(); });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // Pedido que falhou (sem sinal) deixa a marca local valer até a próxima
  // leitura: dali em diante vale o que o servidor tem.
  const markRead = useCallback(async (id: string) => {
    const entry = change({ type: 'read', ids: [id] }); // otimista
    try { await backend.markRead(id); } catch { /* swallow; reconcilia no próximo load */ }
    entry.sending = false;
  }, [backend, change]);

  // Leva os ids que estão na tela. Uma notificação criada durante uma queda e
  // ainda não lida da API fica fora: se a releitura em voo a trouxer não lida,
  // o selo fica com uma a mais até a leitura seguinte.
  const markAllRead = useCallback(async () => {
    const ids = latest.current.filter((n) => !n.read).map((n) => n.id);
    const entry = change({ type: 'read', ids }); // otimista
    try { await backend.markAllRead(); } catch { /* swallow */ }
    entry.sending = false;
  }, [backend, change]);

  const unreadCount = useMemo(() => unreadCountReducer(notifications), [notifications]);

  const value = useMemo<NotificationContextValue>(() => ({
    myId, loadStatus, notifications, unreadCount, load, markRead, markAllRead,
  }), [myId, loadStatus, notifications, unreadCount, load, markRead, markAllRead]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}
