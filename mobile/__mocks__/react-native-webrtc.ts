// Dublê do react-native-webrtc para o Jest, aplicado a toda suíte por estar
// ao lado de node_modules. O módulo de verdade depende do código nativo, que
// só existe no app compilado. Este guarda o que o app pediu (permissão,
// restrições da câmera, conexões criadas) e deixa o teste disparar os eventos
// que a conexão de verdade dispara. Os testes leem o estado pelo `fake`
// exportado, importando 'react-native-webrtc' como o app importa.

type Listener = (event: unknown) => void;

class FakeTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  protected dispatch(type: string, event: object = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

export class MediaStreamTrack {
  stopped = false;
  released = false;
  constructor(readonly kind: string) {}
  stop() {
    this.stopped = true;
  }
  release() {
    this.released = true;
  }
}

export class MediaStream {
  released = false;
  constructor(private readonly tracks: MediaStreamTrack[]) {}
  getTracks() {
    return [...this.tracks];
  }
  release() {
    this.released = true;
  }
}

export class RTCSessionDescription {
  readonly type: string | null;
  readonly sdp: string;
  constructor(info: { type: string | null; sdp: string }) {
    this.type = info.type;
    this.sdp = info.sdp;
  }
}

interface CandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

export class RTCIceCandidate {
  readonly candidate: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
  constructor(init: CandidateInit) {
    this.candidate = init.candidate ?? '';
    this.sdpMid = init.sdpMid;
    this.sdpMLineIndex = init.sdpMLineIndex;
  }
}

export class RTCPeerConnection extends FakeTarget {
  readonly added: { track: MediaStreamTrack; streams: MediaStream[] }[] = [];
  readonly candidates: unknown[] = [];
  localDescription: unknown = null;
  remoteDescription: unknown = null;
  connectionState = 'new';
  closed = false;

  constructor(readonly config: unknown) {
    super();
    fake.peers.push(this);
  }

  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]) {
    this.added.push({ track, streams });
    return {};
  }

  async createOffer() {
    if (fake.offerError) throw fake.offerError;
    return { type: 'offer', sdp: `oferta-${fake.peers.indexOf(this) + 1}` };
  }

  async setLocalDescription(description: unknown) {
    this.localDescription = description;
  }

  async setRemoteDescription(description: unknown) {
    if (fake.answerError) throw fake.answerError;
    this.remoteDescription = description;
  }

  async addIceCandidate(candidate: unknown) {
    this.candidates.push(candidate);
  }

  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }

  /** O que o motor do WebRTC faz ao achar um caminho; null encerra a coleta. */
  emitCandidate(candidate: CandidateInit | null) {
    this.dispatch('icecandidate', { candidate: candidate ? new RTCIceCandidate(candidate) : null });
  }

  emitConnectionState(state: string) {
    this.connectionState = state;
    this.dispatch('connectionstatechange');
  }
}

export const fake = {
  permission: true as unknown,
  permissionRequests: [] as unknown[],
  cameraError: null as Error | null,
  offerError: null as Error | null,
  answerError: null as Error | null,
  constraints: [] as unknown[],
  streams: [] as MediaStream[],
  peers: [] as RTCPeerConnection[],
  reset() {
    fake.permission = true;
    fake.permissionRequests = [];
    fake.cameraError = null;
    fake.offerError = null;
    fake.answerError = null;
    fake.constraints = [];
    fake.streams = [];
    fake.peers = [];
  },
};

export const permissions = {
  async request(descriptor: unknown) {
    fake.permissionRequests.push(descriptor);
    return fake.permission;
  },
};

export const mediaDevices = {
  async getUserMedia(constraints: unknown) {
    fake.constraints.push(constraints);
    if (fake.cameraError) throw fake.cameraError;
    const stream = new MediaStream([new MediaStreamTrack('video')]);
    fake.streams.push(stream);
    return stream;
  },
};
