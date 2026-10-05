import { AppState } from 'react-native';
import { apiRequest, readToken } from '../api/http';
import { liveMedia } from './liveMedia';
import type { LiveCamera, LiveCandidate, LiveIceServer, LiveMedia, LivePeer } from './liveMedia.types';
import { openLiveSocket, type LiveSocket, type LiveSocketEvents } from './liveSocket';

// A transmissão da câmera do celular para os administradores, fora de
// qualquer tela: ligada no dashboard, ela segue com outra tela aberta e acaba
// ao tocar de novo, ao ir para o segundo plano ou ao sair da conta.
//
// O celular oferta. Cada administrador que assiste ganha a própria conexão
// direta com a mesma câmera; o servidor só apresenta um ao outro e repassa a
// sinalização pelo socket, aberto só enquanto a câmera transmite.

/**
 * Prazo para ligar: da resposta da permissão até o servidor aceitar, com a
 * câmera e a busca dos servidores de conexão dentro dele.
 */
export const LIVE_ACCEPT_TIMEOUT_MS = 20_000;

/**
 * Prazo para voltar depois de uma queda com a câmera no ar. Mais longo que o
 * de ligar: em campo a cobertura vai e volta, e o painel volta a assistir
 * sozinho quando a transmissão reaparece.
 */
export const LIVE_RECONNECT_TIMEOUT_MS = 60_000;

/** `starting`: a câmera liga ou espera o servidor aceitar; só `live` acende o ponto. */
export type LiveStatus = 'idle' | 'starting' | 'live';
export type LiveNotice = 'no-permission' | 'failed';

export interface LiveBroadcastState {
  status: LiveStatus;
  notice: LiveNotice | null;
}

export interface LiveBroadcastDeps {
  /** Null onde não há câmera (web). */
  media: LiveMedia | null;
  readToken: () => Promise<string | null>;
  iceServers: () => Promise<LiveIceServer[]>;
  openSocket: (token: string | null, events: LiveSocketEvents) => LiveSocket;
  appState: {
    onChange: (listener: (state: string) => void) => () => void;
  };
}

export interface LiveBroadcast {
  getState(): LiveBroadcastState;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  stop(): void;
  /** O toque no botão: liga em repouso e desliga em qualquer outro estado. */
  toggle(): void;
  dismissNotice(): void;
}

interface Viewer {
  peer: LivePeer;
  /** A oferta já saiu: candidatos daqui seguem direto. */
  offered: boolean;
  outbox: LiveCandidate[];
  answered: boolean;
  /** A resposta do painel já está na conexão: candidatos de lá entram direto. */
  ready: boolean;
  inbox: LiveCandidate[];
}

/** Uma transmissão, do toque até o fim. */
interface Run {
  /** A pergunta da permissão está na tela. */
  asking: boolean;
  camera: LiveCamera | null;
  socket: LiveSocket | null;
  iceServers: LiveIceServer[];
  viewers: Map<string, Viewer>;
  timer: ReturnType<typeof setTimeout> | null;
  /** Cada anúncio tem um número; resposta de anúncio antigo não vale. */
  announcement: number;
  stopListening: () => void;
}

export function createLiveBroadcast(deps: LiveBroadcastDeps): LiveBroadcast {
  let state: LiveBroadcastState = { status: 'idle', notice: null };
  const listeners = new Set<() => void>();
  let run: Run | null = null;

  const publish = (next: LiveBroadcastState) => {
    if (next.status === state.status && next.notice === state.notice) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const clearTimer = (current: Run) => {
    if (current.timer) clearTimeout(current.timer);
    current.timer = null;
  };

  const closeViewer = (current: Run, sessionId: string) => {
    const viewer = current.viewers.get(sessionId);
    if (!viewer) return;
    current.viewers.delete(sessionId);
    viewer.peer.close();
  };

  const closeViewers = (current: Run) => {
    for (const sessionId of [...current.viewers.keys()]) closeViewer(current, sessionId);
  };

  /** Encerra a transmissão e solta conexões, socket e câmera. */
  const end = (notice: LiveNotice | null) => {
    const current = run;
    run = null;
    if (current) {
      clearTimer(current);
      current.stopListening();
      closeViewers(current);
      current.socket?.close();
      current.camera?.stop();
    }
    publish({ status: 'idle', notice });
  };

  const armDeadline = (current: Run, ms: number) => {
    clearTimer(current);
    current.timer = setTimeout(() => {
      if (run === current) end('failed');
    }, ms);
  };

  const announce = async (current: Run, socket: LiveSocket) => {
    current.announcement += 1;
    const mine = current.announcement;
    const accepted = await socket.announce();
    if (run !== current || mine !== current.announcement) return;
    if (!accepted) {
      end('failed');
      return;
    }
    clearTimer(current);
    publish({ status: 'live', notice: null });
  };

  const dropped = (current: Run, refused: boolean) => {
    // O servidor já encerrou a transmissão e as sessões deste socket: as
    // conexões abertas ficaram sem par, e a resposta pendente não vale mais.
    current.announcement += 1;
    closeViewers(current);
    if (refused) {
      end('failed');
      return;
    }
    publish({ status: 'starting', notice: null });
    // Antes do primeiro aceite o prazo de ligar já corre e não recomeça.
    if (!current.timer) armDeadline(current, LIVE_RECONNECT_TIMEOUT_MS);
  };

  const addViewer = async (current: Run, socket: LiveSocket, camera: LiveCamera, sessionId: string) => {
    if (current.viewers.has(sessionId)) return;
    let viewer: Viewer | null = null;
    const owns = () => viewer !== null && run === current && current.viewers.get(sessionId) === viewer;
    try {
      // O nativo pode recusar criar a conexão (servidor de conexão inválido,
      // por exemplo): cai no catch como qualquer outra falha deste espectador.
      const peer = camera.connect({
        iceServers: current.iceServers,
        onCandidate: (candidate) => {
          if (!owns() || !viewer) return;
          // O painel só monta a conexão quando a oferta chega; o que vem
          // antes dela espera aqui.
          if (viewer.offered) socket.candidate(sessionId, candidate);
          else viewer.outbox.push(candidate);
        },
        onFailed: () => {
          if (owns()) closeViewer(current, sessionId);
        },
      });
      viewer = { peer, offered: false, outbox: [], answered: false, ready: false, inbox: [] };
      current.viewers.set(sessionId, viewer);
      const sdp = await viewer.peer.offer();
      if (!owns()) return;
      socket.offer(sessionId, sdp);
      viewer.offered = true;
      for (const candidate of viewer.outbox.splice(0)) socket.candidate(sessionId, candidate);
    } catch {
      // Sem oferta não há imagem para esse administrador; o painel dele avisa
      // a falha pelo prazo de lá.
      if (owns()) closeViewer(current, sessionId);
    }
  };

  const acceptAnswer = async (current: Run, sessionId: string, sdp: string) => {
    const viewer = current.viewers.get(sessionId);
    if (!viewer || viewer.answered) return;
    viewer.answered = true;
    try {
      await viewer.peer.acceptAnswer(sdp);
      if (current.viewers.get(sessionId) !== viewer) return;
      viewer.ready = true;
      for (const candidate of viewer.inbox.splice(0)) await addCandidate(viewer, candidate);
    } catch {
      if (current.viewers.get(sessionId) === viewer) closeViewer(current, sessionId);
    }
  };

  /** Candidato que a conexão recusa não a derruba: os outros servem. */
  const addCandidate = async (viewer: Viewer, candidate: LiveCandidate) => {
    try {
      await viewer.peer.addCandidate(candidate);
    } catch {
      // Ignorado de propósito.
    }
  };

  const remoteCandidate = async (current: Run, sessionId: string, candidate: LiveCandidate) => {
    const viewer = current.viewers.get(sessionId);
    if (!viewer) return;
    if (!viewer.ready) {
      viewer.inbox.push(candidate);
      return;
    }
    await addCandidate(viewer, candidate);
  };

  const eventsFor = (current: Run, camera: LiveCamera): LiveSocketEvents => {
    // Aviso de uma transmissão que já acabou não mexe em nada.
    const live = () => run === current;
    const socket = () => current.socket!;
    return {
      onConnect: () => {
        if (live()) void announce(current, socket());
      },
      onDisconnect: (refused) => {
        if (live()) dropped(current, refused);
      },
      onViewer: (sessionId) => {
        if (live()) void addViewer(current, socket(), camera, sessionId);
      },
      onAnswer: (sessionId, sdp) => {
        if (live()) void acceptAnswer(current, sessionId, sdp);
      },
      onCandidate: (sessionId, candidate) => {
        if (live()) void remoteCandidate(current, sessionId, candidate);
      },
      onViewerLeft: (sessionId) => {
        if (live()) closeViewer(current, sessionId);
      },
      onClosed: () => {
        if (live()) end(null);
      },
    };
  };

  const start = async () => {
    if (run) return;
    const current: Run = {
      asking: true,
      camera: null,
      socket: null,
      iceServers: [],
      viewers: new Map(),
      timer: null,
      announcement: 0,
      stopListening: () => {},
    };
    run = current;
    publish({ status: 'starting', notice: null });
    current.stopListening = deps.appState.onChange((next) => {
      // A pergunta da permissão no Android tira o app do primeiro plano
      // enquanto está na tela. A resposta só chega com o app de volta, nos
      // dois sistemas, então daí em diante o segundo plano é saída de verdade.
      if (next === 'background' && !current.asking && run === current) end(null);
    });

    const media = deps.media;
    if (!media) {
      end('failed');
      return;
    }
    let granted: boolean;
    try {
      granted = await media.requestCameraPermission();
    } catch {
      if (run === current) end('failed');
      return;
    }
    if (run !== current) return;
    if (!granted) {
      end('no-permission');
      return;
    }

    current.asking = false;
    // Daqui até o aceite a câmera já pode estar ligada: um prazo só cobre a
    // câmera, a busca dos servidores de conexão e o anúncio.
    armDeadline(current, LIVE_ACCEPT_TIMEOUT_MS);
    try {
      const camera = await media.openCamera();
      if (run !== current) {
        camera.stop();
        return;
      }
      current.camera = camera;
      const [iceServers, token] = await Promise.all([deps.iceServers(), deps.readToken()]);
      if (run !== current) return;
      current.iceServers = iceServers;
      current.socket = deps.openSocket(token, eventsFor(current, camera));
    } catch {
      if (run === current) end('failed');
    }
  };

  const stop = () => end(null);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    stop,
    toggle() {
      if (run) stop();
      else void start();
    },
    dismissNotice() {
      publish({ status: state.status, notice: null });
    },
  };
}

async function fetchIceServers(): Promise<LiveIceServer[]> {
  const body = await apiRequest<{ iceServers?: unknown }>('/live/ice-servers', { auth: true });
  return Array.isArray(body?.iceServers) ? (body.iceServers as LiveIceServer[]) : [];
}

/** A transmissão única do app. */
export const liveBroadcast = createLiveBroadcast({
  media: liveMedia,
  readToken,
  iceServers: fetchIceServers,
  openSocket: openLiveSocket,
  appState: {
    onChange: (listener) => {
      const subscription = AppState.addEventListener('change', listener);
      return () => subscription.remove();
    },
  },
});
