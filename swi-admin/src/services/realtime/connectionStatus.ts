// Estado da conexão em tempo real do painel. Os quatro serviços de socket
// (telemetria, posições, chat, evacuação) registram aqui as próprias conexões,
// e a tela lê uma resposta só: a conexão caiu ou não. O módulo não conhece
// React; o hook que a tela usa fica em hooks/useConnectionLost.

/** Tempo que um socket pode ficar caído antes de a tela avisar (decisão D3). */
export const CONNECTION_GRACE_MS = 5_000

// O servidor recusou a sessão ou a própria tela fechou a conexão: nenhum dos
// dois é rede caída, e o socket.io não tenta reconectar depois deles.
const NOT_A_DROP = new Set(['io server disconnect', 'io client disconnect'])

/** O que o armazém usa de um socket do socket.io. */
export interface WatchedSocket {
  on(event: string, listener: (reason?: unknown) => void): unknown
  off(event: string, listener: (reason?: unknown) => void): unknown
}

export interface ConnectionStatus {
  /** Passa a acompanhar o socket; o retorno para de acompanhar e tira os ouvintes. */
  watch(socket: WatchedSocket): () => void
  /** Há socket caído há mais que a carência. */
  isLost(): boolean
  /** Avisa quando `isLost()` muda. */
  subscribe(listener: () => void): () => void
  /**
   * Avisa quando o último socket caído reconecta, por menor que tenha sido a
   * queda: os avisos desse intervalo se perderam, e a tela relê pela API.
   */
  onReconnect(listener: () => void): () => void
}

// `expired` é marcado pelo próprio timer da carência, e não pela conta com o
// relógio de parede: relógio do sistema ajustado para trás, ou com precisão
// reduzida, faria a conta dar menos que a carência e a queda nunca virar aviso.
type Entry = { down: boolean; expired: boolean; timer: ReturnType<typeof setTimeout> | null }

export function createConnectionStatus(graceMs: number = CONNECTION_GRACE_MS): ConnectionStatus {
  const entries = new Set<Entry>()
  const listeners = new Set<() => void>()
  const reconnectListeners = new Set<() => void>()
  let lost = false
  // Algum socket voltou enquanto outro seguia caído: a releitura fica devendo
  // até não sobrar socket caído, inclusive quando o último sai do registro.
  let backPending = false

  const anyDown = () => [...entries].some((e) => e.down)

  // A queda vira aviso quando algum socket passa da carência, e o aviso só sai
  // quando nenhum socket está caído, para não piscar entre quedas sobrepostas.
  const recompute = () => {
    const next = [...entries].some((e) => e.expired) || (lost && anyDown())
    if (next === lost) return
    lost = next
    for (const l of [...listeners]) l()
  }

  const settleBack = () => {
    if (!backPending || anyDown()) return
    backPending = false
    for (const l of [...reconnectListeners]) l()
  }

  const markUp = (entry: Entry) => {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    entry.down = false
    entry.expired = false
  }

  const markDown = (entry: Entry) => {
    // Cada tentativa de reconexão que falha repete o aviso; a carência conta
    // desde a primeira.
    if (entry.down) return
    entry.down = true
    entry.timer = setTimeout(() => {
      entry.timer = null
      entry.expired = true
      recompute()
    }, graceMs)
  }

  return {
    watch(socket) {
      const entry: Entry = { down: false, expired: false, timer: null }
      entries.add(entry)

      const onConnect = () => {
        if (entry.down) backPending = true
        markUp(entry)
        recompute()
        settleBack()
      }
      const onDisconnect = (reason?: unknown) => {
        if (typeof reason === 'string' && NOT_A_DROP.has(reason)) {
          markUp(entry)
          recompute()
          settleBack()
          return
        }
        markDown(entry)
      }
      const onError = () => markDown(entry)

      socket.on('connect', onConnect)
      socket.on('disconnect', onDisconnect)
      socket.on('connect_error', onError)

      let active = true
      return () => {
        if (!active) return
        active = false
        socket.off('connect', onConnect)
        socket.off('disconnect', onDisconnect)
        socket.off('connect_error', onError)
        markUp(entry)
        entries.delete(entry)
        recompute()
        settleBack()
      }
    },
    isLost: () => lost,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onReconnect(listener) {
      reconnectListeners.add(listener)
      return () => {
        reconnectListeners.delete(listener)
      }
    },
  }
}

/** O armazém único do painel, alimentado pelos serviços de socket. */
export const connectionStatus = createConnectionStatus()
