// O aviso de alerta urgente lê daqui. Um armazém por sessão, montado no
// ChatShell, para o aviso cobrir as telas com menu e as de tela cheia. Relê
// quando a conexão volta e quando a aba volta a ficar visível (os avisos de
// socket desse intervalo se perderam), e manda os alertas novos para a
// notificação do navegador.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { AlertQueueItem } from '@/services/api/telemetry'
import { telemetryApi } from '@/services/api/telemetry'
import { subscribeTelemetryEvents } from '@/services/telemetry/telemetrySocket'
import { connectionStatus } from '@/services/realtime/connectionStatus'
import { showUrgentBrowserNotice } from '@/services/browserNotifications/browserNotifications'
import { onAlertTriaged } from './alertTriage'
import { initialUrgentAlerts, visibleAlerts } from './urgentAlerts'
import { createUrgentAlertsStore, type UrgentAlertsStore } from './urgentAlertsStore'

/** Onde o admin trata o alerta. */
export const URGENT_ALERTS_PATH = '/monitoring/alerts'

const UrgentAlertsContext = createContext<UrgentAlertsStore | null>(null)

export function UrgentAlertsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  // O clique na notificação do navegador chega depois, fora do React: lê a
  // navegação mais recente.
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  const [store] = useState(() =>
    createUrgentAlertsStore({
      api: telemetryApi,
      subscribeConditions: (onCondition) =>
        subscribeTelemetryEvents({ onSnapshot: () => {}, onCondition }),
      onTriaged: onAlertTriaged,
      onFresh: (fresh) => {
        showUrgentBrowserNotice(
          fresh.map((a) => a.id),
          () => navigateRef.current(URGENT_ALERTS_PATH),
        )
      },
    }),
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

  return <UrgentAlertsContext.Provider value={store}>{children}</UrgentAlertsContext.Provider>
}

export type UrgentAlertsView = {
  /** Urgentes abertos que o admin não fechou, mais novo primeiro. */
  visible: AlertQueueItem[]
  dismiss: () => void
}

const EMPTY = initialUrgentAlerts()
const noSubscribe = () => () => {}
const emptySnapshot = () => EMPTY

/** Null fora do provider: o aviso some, e as telas testadas sozinhas não quebram. */
export function useUrgentAlerts(): UrgentAlertsView | null {
  const store = useContext(UrgentAlertsContext)
  const state = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getState ?? emptySnapshot,
  )
  if (!store) return null
  return { visible: visibleAlerts(state), dismiss: store.dismiss }
}
