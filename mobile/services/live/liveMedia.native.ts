import {
  mediaDevices,
  permissions,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStream,
} from 'react-native-webrtc';
import type { LiveMedia, LivePeer, LivePeerOptions } from './liveMedia.types';

// A câmera do celular na transmissão ao vivo. Só este arquivo conhece o
// react-native-webrtc: o Metro o escolhe para Android e iOS, e a web recebe
// liveMedia.ts, sem câmera.

/** Câmera traseira em 640x480 a 15 quadros: basta para ver o local sem pesar na rede móvel. */
const LIVE_VIDEO = { facingMode: 'environment', width: 640, height: 480, frameRate: 15 };

// As tipagens publicadas da biblioteca não incluem o EventTarget que a
// conexão estende, e o tsc não enxerga o `addEventListener`. Este é o pedaço
// usado aqui, com o formato dos eventos da própria biblioteca.
interface PeerEvents {
  addEventListener(type: 'icecandidate', listener: (event: { candidate: RTCIceCandidate | null }) => void): void;
  addEventListener(type: 'connectionstatechange', listener: () => void): void;
}

function connect(stream: MediaStream, { iceServers, onCandidate, onFailed }: LivePeerOptions): LivePeer {
  const peer = new RTCPeerConnection({ iceServers });
  const events = peer as unknown as PeerEvents;
  // Depois de fechar, o motor ainda pode avisar; ninguém mais escuta.
  let closed = false;
  for (const track of stream.getTracks()) peer.addTrack(track, stream);
  events.addEventListener('icecandidate', (event) => {
    const { candidate } = event;
    // Candidato nulo é o fim da coleta: não há o que repassar.
    if (closed || !candidate) return;
    onCandidate({
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    });
  });
  events.addEventListener('connectionstatechange', () => {
    if (!closed && peer.connectionState === 'failed') onFailed();
  });
  return {
    async offer() {
      const description: { sdp?: string } = await peer.createOffer();
      await peer.setLocalDescription(description as RTCSessionDescription);
      if (!description.sdp) throw new Error('Oferta sem SDP.');
      return description.sdp;
    },
    acceptAnswer: (sdp) => peer.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp })),
    addCandidate: (candidate) => peer.addIceCandidate(new RTCIceCandidate(candidate)),
    close() {
      closed = true;
      peer.close();
    },
  };
}

export const liveMedia: LiveMedia | null = {
  // Pedida antes de ligar a câmera para separar "sem permissão" de "falhou".
  requestCameraPermission: async () => (await permissions.request({ name: 'camera' })) === true,
  async openCamera() {
    const stream = await mediaDevices.getUserMedia({ audio: false, video: { ...LIVE_VIDEO } });
    return {
      connect: (options) => connect(stream, options),
      stop() {
        for (const track of stream.getTracks()) track.stop();
        stream.release();
      },
    };
  },
};
