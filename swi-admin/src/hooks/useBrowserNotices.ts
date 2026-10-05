import { useSyncExternalStore } from 'react'
import {
  browserNoticeSupport,
  browserNoticesDeclined,
  browserNoticesEnabled,
  disableBrowserNotices,
  requestBrowserNotices,
  subscribeBrowserNotices,
  type BrowserNoticeSupport,
} from '@/services/browserNotifications/browserNotifications'

export type BrowserNoticesView = {
  support: BrowserNoticeSupport
  /** Permissão dada e preferência ligada. */
  enabled: boolean
  /** O admin desligou, negou ou fechou o pedido: o sino para de oferecer. */
  declined: boolean
  /** Chamar só dentro de um clique. */
  request: () => Promise<BrowserNoticeSupport>
  disable: () => void
}

// A permissão pode mudar nas configurações do navegador sem aviso nenhum à
// página: relê quando a aba volta ao foco ou a ficar visível.
function subscribe(listener: () => void): () => void {
  const stop = subscribeBrowserNotices(listener)
  window.addEventListener('focus', listener)
  document.addEventListener('visibilitychange', listener)
  return () => {
    stop()
    window.removeEventListener('focus', listener)
    document.removeEventListener('visibilitychange', listener)
  }
}

const flag = (on: boolean) => (on ? '1' : '0')
const snapshot = () =>
  `${browserNoticeSupport()}|${flag(browserNoticesEnabled())}|${flag(browserNoticesDeclined())}`

export function useBrowserNotices(): BrowserNoticesView {
  const [support, enabled, declined] = useSyncExternalStore(subscribe, snapshot).split('|')
  return {
    support: support as BrowserNoticeSupport,
    enabled: enabled === '1',
    declined: declined === '1',
    request: requestBrowserNotices,
    disable: disableBrowserNotices,
  }
}
