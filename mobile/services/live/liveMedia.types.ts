// O que o serviço da transmissão ao vivo usa da câmera e da conexão direta com
// o painel. O react-native-webrtc só aparece em liveMedia.native.ts; o serviço
// fala com estas interfaces e é testado com dublês delas.

/** Servidor de conexão no formato do navegador, como `GET /live/ice-servers` devolve. */
export interface LiveIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Candidato de conexão, só com os campos que o servidor repassa. */
export interface LiveCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

export interface LivePeerOptions {
  iceServers: LiveIceServer[];
  /** Caminho achado deste lado, para o painel. */
  onCandidate: (candidate: LiveCandidate) => void;
  /** A conexão direta não fechou ou caiu de vez. */
  onFailed: () => void;
}

/** Conexão direta com um administrador que assiste. */
export interface LivePeer {
  /** Cria a oferta com a imagem da câmera e a guarda como descrição local; devolve o SDP. */
  offer(): Promise<string>;
  acceptAnswer(sdp: string): Promise<void>;
  addCandidate(candidate: LiveCandidate): Promise<void>;
  close(): void;
}

/** A câmera ligada: uma só, compartilhada por todas as conexões. */
export interface LiveCamera {
  connect(options: LivePeerOptions): LivePeer;
  /** Desliga a câmera e libera o recurso nativo. */
  stop(): void;
}

export interface LiveMedia {
  /** Pede a permissão da câmera; true quando liberada. */
  requestCameraPermission(): Promise<boolean>;
  /** Liga a câmera traseira, só imagem. */
  openCamera(): Promise<LiveCamera>;
}
