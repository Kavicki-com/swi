import { useEffect, useState, useSyncExternalStore } from 'react'
import { connectionStatus } from '@/services/realtime/connectionStatus'

const browserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

// O painel está sem conexão com o servidor: o navegador avisou que ficou
// offline (vale na hora) ou um socket está caído há mais que a carência.
export function useConnectionLost(): boolean {
  const socketLost = useSyncExternalStore(connectionStatus.subscribe, connectionStatus.isLost)
  const [offline, setOffline] = useState(browserOffline)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  return offline || socketLost
}
