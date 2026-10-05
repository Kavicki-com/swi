import { io, type Socket } from 'socket.io-client';
import { getApiUrl } from '../auth/apiConfig';
import { connectionStatus } from '../realtime/connectionStatus';
import type { LiveCandidate } from './liveMedia.types';

/** Prazo da confirmação do servidor ao anunciar a transmissão. */
export const LIVE_ACK_TIMEOUT_MS = 10_000;

export interface LiveSocketEvents {
  /** Conectou ou reconectou: a transmissão precisa ser anunciada de novo. */
  onConnect: () => void;
  /** `refused`: o servidor fechou a conexão, e o socket.io não tenta de novo. */
  onDisconnect: (refused: boolean) => void;
  /** Um administrador quer assistir: o celular cria a conexão e oferta. */
  onViewer: (sessionId: string) => void;
  onAnswer: (sessionId: string, sdp: string) => void;
  onCandidate: (sessionId: string, candidate: LiveCandidate) => void;
  /** Ordem de fechar a conexão daquela sessão, não só aviso. */
  onViewerLeft: (sessionId: string) => void;
  /** O servidor encerrou a transmissão deste aparelho. */
  onClosed: () => void;
}

export interface LiveSocket {
  /** Anuncia a transmissão; true quando o servidor aceita. */
  announce: () => Promise<boolean>;
  offer: (sessionId: string, sdp: string) => void;
  candidate: (sessionId: string, candidate: LiveCandidate) => void;
  /** Fecha o socket; o servidor encerra a transmissão dele ao ver a queda. */
  close: () => void;
}

const MAX_ID_LENGTH = 64;

const fields = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isOptionalId = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && value.length <= MAX_ID_LENGTH);

const isOptionalIndex = (value: unknown) =>
  value === undefined || value === null || (Number.isInteger(value) && (value as number) >= 0);

/** Copia só os campos do candidato que o protocolo conhece; o resto fica para trás. */
function candidateOf(value: unknown): LiveCandidate | null {
  const { candidate, sdpMid, sdpMLineIndex } = fields(value);
  if (typeof candidate !== 'string' || !isOptionalId(sdpMid) || !isOptionalIndex(sdpMLineIndex)) return null;
  const copy: LiveCandidate = { candidate };
  if (sdpMid !== undefined) copy.sdpMid = sdpMid as string | null;
  if (sdpMLineIndex !== undefined) copy.sdpMLineIndex = sdpMLineIndex as number | null;
  return copy;
}

/**
 * Socket da transmissão ao vivo: mesmo servidor e mesmo token dos outros
 * sockets do app, numa conexão própria aberta só enquanto a câmera transmite.
 * Aviso fora do contrato é descartado aqui, antes de chegar ao serviço.
 */
export function openLiveSocket(token: string | null, events: LiveSocketEvents): LiveSocket {
  // Polling primeiro, com upgrade para WS: espelho das notificações e do chat.
  const socket: Socket = io(getApiUrl(), {
    auth: { token },
    transports: ['polling', 'websocket'],
  });
  // O aviso de sem conexão do app também lê este socket enquanto ele existe.
  const unwatch = connectionStatus.watch(socket);

  socket.on('connect', () => events.onConnect());
  socket.on('disconnect', (reason: string) => events.onDisconnect(reason === 'io server disconnect'));
  socket.on('live.viewer', (raw: unknown) => {
    const { sessionId } = fields(raw);
    if (isText(sessionId)) events.onViewer(sessionId);
  });
  socket.on('live.answer', (raw: unknown) => {
    const { sessionId, sdp } = fields(raw);
    if (isText(sessionId) && isText(sdp)) events.onAnswer(sessionId, sdp);
  });
  socket.on('live.candidate', (raw: unknown) => {
    const { sessionId, candidate } = fields(raw);
    const copy = candidateOf(candidate);
    if (isText(sessionId) && copy) events.onCandidate(sessionId, copy);
  });
  socket.on('live.viewer-left', (raw: unknown) => {
    const { sessionId } = fields(raw);
    if (isText(sessionId)) events.onViewerLeft(sessionId);
  });
  socket.on('live.closed', () => events.onClosed());

  return {
    async announce() {
      try {
        const reply = fields(await socket.timeout(LIVE_ACK_TIMEOUT_MS).emitWithAck('live.start'));
        return reply.ok === true;
      } catch {
        return false;
      }
    },
    offer: (sessionId, sdp) => {
      socket.emit('live.offer', { sessionId, sdp });
    },
    candidate: (sessionId, candidate) => {
      socket.emit('live.candidate', { sessionId, candidate });
    },
    close: () => {
      // Sem `live.stop`: o servidor encerra a transmissão deste socket quando
      // ele cai, e só a dele. O `live.stop` vindo de um socket que não
      // transmite para a transmissão do funcionário em outro socket, e o
      // celular que acabou de perder a vez para outro aparelho derrubaria o
      // aparelho novo.
      unwatch();
      socket.close();
    },
  };
}
