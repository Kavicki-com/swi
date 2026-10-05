// Estado da conexão em tempo real do app. Os backends de notificações e de
// chat registram aqui os próprios sockets, e o aviso lê uma resposta só: a
// conexão caiu ou não. O módulo não conhece React nem o AppState; quem liga a
// pausa ao segundo plano é o hook useConnectionLost.

/** Tempo que um socket pode ficar caído antes de o app avisar (decisão D3). */
export const CONNECTION_GRACE_MS = 10_000;

// O servidor recusou a sessão ou o próprio app fechou a conexão: nenhum dos
// dois é rede caída, e o socket.io não tenta reconectar depois deles.
const NOT_A_DROP = new Set(['io server disconnect', 'io client disconnect']);

/** O que o armazém usa de um socket do socket.io. */
export interface WatchedSocket {
  on(event: string, listener: (reason?: unknown) => void): unknown;
  off(event: string, listener: (reason?: unknown) => void): unknown;
}

export interface ConnectionStatus {
  /** Passa a acompanhar o socket; o retorno para de acompanhar e tira os ouvintes. */
  watch(socket: WatchedSocket): () => void;
  /** Há socket caído há mais que a carência. */
  isLost(): boolean;
  /** Avisa quando `isLost()` muda. */
  subscribe(listener: () => void): () => void;
  /**
   * Avisa quando o último socket caído reconecta, por menor que tenha sido a
   * queda: os avisos desse intervalo se perderam, e a tela relê pela API.
   */
  onReconnect(listener: () => void): () => void;
  /** O app foi para o segundo plano: a carência para de correr. */
  pause(): void;
  /** O app voltou ao primeiro plano: a carência de quem está caído conta do zero. */
  resume(): void;
}

// `expired` é marcado pelo próprio timer da carência, e não pela conta com o
// relógio de parede: relógio do sistema ajustado para trás faria a conta dar
// menos que a carência e a queda nunca virar aviso.
type Entry = { down: boolean; expired: boolean; timer: ReturnType<typeof setTimeout> | null };

export function createConnectionStatus(graceMs: number = CONNECTION_GRACE_MS): ConnectionStatus {
  const entries = new Set<Entry>();
  const listeners = new Set<() => void>();
  const reconnectListeners = new Set<() => void>();
  let lost = false;
  // Algum socket voltou enquanto outro seguia caído: a releitura fica devendo
  // até não sobrar socket caído, inclusive quando o último sai do registro.
  let backPending = false;
  // Com o app parado o sistema suspende os timers, que disparariam todos
  // juntos na volta: a carência só corre com o app no primeiro plano.
  let paused = false;

  const anyDown = () => [...entries].some((e) => e.down);

  // A queda vira aviso quando algum socket passa da carência, e o aviso só sai
  // quando nenhum socket está caído, para não piscar entre quedas sobrepostas.
  const recompute = () => {
    const next = [...entries].some((e) => e.expired) || (lost && anyDown());
    if (next === lost) return;
    lost = next;
    for (const l of [...listeners]) l();
  };

  const settleBack = () => {
    if (!backPending || anyDown()) return;
    backPending = false;
    for (const l of [...reconnectListeners]) l();
  };

  const stopTimer = (entry: Entry) => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
  };

  const startTimer = (entry: Entry) => {
    stopTimer(entry);
    if (paused) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.expired = true;
      recompute();
    }, graceMs);
  };

  const markUp = (entry: Entry) => {
    stopTimer(entry);
    entry.down = false;
    entry.expired = false;
  };

  const markDown = (entry: Entry) => {
    // Cada tentativa de reconexão que falha repete o aviso; a carência conta
    // desde a primeira.
    if (entry.down) return;
    entry.down = true;
    startTimer(entry);
  };

  return {
    watch(socket) {
      const entry: Entry = { down: false, expired: false, timer: null };
      entries.add(entry);

      const onConnect = () => {
        if (entry.down) backPending = true;
        markUp(entry);
        recompute();
        settleBack();
      };
      const onDisconnect = (reason?: unknown) => {
        if (typeof reason === 'string' && NOT_A_DROP.has(reason)) {
          markUp(entry);
          recompute();
          settleBack();
          return;
        }
        markDown(entry);
      };
      const onError = () => markDown(entry);

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('connect_error', onError);

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('connect_error', onError);
        markUp(entry);
        entries.delete(entry);
        recompute();
        settleBack();
      };
    },
    isLost: () => lost,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onReconnect(listener) {
      reconnectListeners.add(listener);
      return () => {
        reconnectListeners.delete(listener);
      };
    },
    pause() {
      paused = true;
      for (const entry of entries) stopTimer(entry);
    },
    resume() {
      if (!paused) return;
      paused = false;
      // O aviso que já estava na tela fica (recompute só o tira sem socket
      // caído); quem ainda não tinha virado aviso ganha a carência inteira.
      for (const entry of entries) {
        if (!entry.down) continue;
        entry.expired = false;
        startTimer(entry);
      }
      recompute();
    },
  };
}

/** O armazém único do app, alimentado pelos backends de notificações e de chat. */
export const connectionStatus = createConnectionStatus();
