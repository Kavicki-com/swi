// Pedido de ajuda do botão "Ajuda urgente". Espelho local do contrato REST do
// swi-backend (POST /help-requests e GET /help-requests/mine): os apps são
// irmãos isolados, então este arquivo é a fronteira e precisa ser conferido à
// mão quando o contrato mudar. Datas em ISO-8601.

/** OPEN: ninguém atendeu ainda. ATTENDED: a central atendeu. CLOSED: encerrado. */
export type HelpRequestStatus = 'OPEN' | 'ATTENDED' | 'CLOSED';

/** Estado do resgate despachado para o pedido. */
export type HelpRescueStatus = 'dispatched' | 'arrived' | 'ended';

export interface RescuerPosition {
  lat: number;
  lng: number;
  recordedAt: string;
}

export interface HelpRescue {
  id: string;
  status: HelpRescueStatus;
  dispatchedAt: string;
  arrivedAt: string | null;
  /** Última posição conhecida do socorrista; nula sem posição gravada e depois do encerramento. */
  rescuerPosition: RescuerPosition | null;
}

/** O pedido como o próprio funcionário o lê. */
export interface HelpRequestView {
  id: string;
  status: HelpRequestStatus;
  createdAt: string;
  attendedAt: string | null;
  closedAt: string | null;
  /** Nulo enquanto ninguém foi despachado. */
  rescue: HelpRescue | null;
}

/** Aviso de socket `help-request.changed`: só identificadores e estado. */
export interface HelpRequestChanged {
  workerId: string;
  helpRequestId: string;
  status: HelpRequestStatus;
  at: string;
}

export interface HelpRequestBackend {
  /**
   * Pede ajuda. `idempotencyKey` (UUID v4) vai igual em toda tentativa do
   * mesmo toque; com um pedido aberto ou atendido o backend devolve o mesmo.
   */
  request(idempotencyKey: string): Promise<HelpRequestView>;
  /** O pedido mais recente, em qualquer estado; null se nunca pediu. */
  mine(): Promise<HelpRequestView | null>;
  /** Escuta as mudanças de estado do pedido. Devolve o cancelamento. */
  subscribe(onChanged: (change: HelpRequestChanged) => void): () => void;
}
