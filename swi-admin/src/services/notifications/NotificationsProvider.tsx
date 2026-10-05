// O sino lê daqui. Um armazém por sessão, montado no ChatShell (todas as telas
// logadas), para o contador e a lista serem uma fonte só em qualquer cabeçalho.
// Relê quando a conexão volta e quando a aba volta a ficar visível; o sino pede
// mais uma releitura ao abrir.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { notificationsApi } from '@/services/api/notifications'
import { connectionStatus } from '@/services/realtime/connectionStatus'
import { initialNotifications, unreadCount, type NotificationsState } from './notificationList'
import { createNotificationsStore, type NotificationsStore } from './notificationsStore'
import { subscribeNotifications } from './notificationsSocket'

const NotificationsContext = createContext<NotificationsStore | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() =>
    createNotificationsStore({ api: notificationsApi, subscribe: subscribeNotifications }),
  )

  useEffect(() => {
    const stop = store.start()
    const stopReconnect = connectionStatus.onReconnect(store.refresh)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') store.refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      stopReconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [store])

  return <NotificationsContext.Provider value={store}>{children}</NotificationsContext.Provider>
}

export type NotificationsView = {
  state: NotificationsState
  unread: number
  refresh: () => void
  markRead: (id: string) => void
  markAllRead: () => void
}

const EMPTY = initialNotifications()
const noSubscribe = () => () => {}
const emptySnapshot = () => EMPTY

/** Null fora do provider: o sino some, e as telas testadas sozinhas não quebram. */
export function useNotifications(): NotificationsView | null {
  const store = useContext(NotificationsContext)
  const state = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getState ?? emptySnapshot,
  )
  if (!store) return null
  return {
    state,
    unread: unreadCount(state),
    refresh: store.refresh,
    markRead: store.markRead,
    markAllRead: store.markAllRead,
  }
}
