import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type PropsWithChildren,
} from 'react';
import type { AppNotification } from './types';
import { getNotificationBackend } from './getNotificationBackend';
import {
  applyNotification,
  markRead as markReadReducer,
  markAllRead as markAllReadReducer,
  unreadCount as unreadCountReducer,
} from './notificationReducers';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

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

  const load = useCallback(() => {
    setLoadStatus('loading');
    return backend.listNotifications().then(
      (ns) => { setNotifications(ns); setLoadStatus(ns.length ? 'ready' : 'empty'); },
      () => { setLoadStatus('error'); },
    );
  }, [backend]);

  useEffect(() => { load(); }, [load]);

  // Feed ao vivo: o servidor (event bus do mock, Socket.IO na API real) empurra novas
  // notificações; o reducer faz update-or-insert e re-ordena.
  useEffect(() => {
    const unsub = backend.subscribe((n) => {
      setNotifications((prev) => applyNotification(prev, n));
    });
    return unsub;
  }, [backend]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) => markReadReducer(prev, id)); // otimista
    try { await backend.markRead(id); } catch { /* swallow; reconcilia no próximo load */ }
  }, [backend]);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => markAllReadReducer(prev)); // otimista
    try { await backend.markAllRead(); } catch { /* swallow */ }
  }, [backend]);

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
