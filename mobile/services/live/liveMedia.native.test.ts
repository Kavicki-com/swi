import * as webrtc from 'react-native-webrtc';
import type * as FakeWebRTC from '../../__mocks__/react-native-webrtc';
import { liveMedia } from './liveMedia.native';
import type { LivePeerOptions } from './liveMedia.types';

// O adaptador é a única parte do app que fala com o react-native-webrtc. O
// módulo nativo é o dublê de __mocks__; aqui se confere o que o app pede a ele.
// O import passa pelo mesmo caminho do adaptador e recebe a mesma instância do
// dublê (o `jest.requireMock` devolveria outra).
const { fake } = webrtc as unknown as typeof FakeWebRTC;

const media = liveMedia!;

const options = (over: Partial<LivePeerOptions> = {}): LivePeerOptions => ({
  iceServers: [{ urls: 'stun:stun.example.org:3478' }],
  onCandidate: jest.fn(),
  onFailed: jest.fn(),
  ...over,
});

beforeEach(() => fake.reset());

describe('permissão', () => {
  it('pede só a câmera, nunca o microfone', async () => {
    await media.requestCameraPermission();
    expect(fake.permissionRequests).toEqual([{ name: 'camera' }]);
  });

  it('liberada vira true; negada vira false', async () => {
    expect(await media.requestCameraPermission()).toBe(true);
    fake.permission = false;
    expect(await media.requestCameraPermission()).toBe(false);
  });

  it('resposta que não é um sim explícito conta como negada', async () => {
    fake.permission = 'denied';
    expect(await media.requestCameraPermission()).toBe(false);
  });
});

describe('câmera', () => {
  it('liga a câmera traseira em 640x480 a 15 quadros, sem áudio', async () => {
    await media.openCamera();
    expect(fake.constraints).toEqual([
      { audio: false, video: { facingMode: 'environment', width: 640, height: 480, frameRate: 15 } },
    ]);
  });

  it('desligar para cada trilha e libera o recurso nativo', async () => {
    const camera = await media.openCamera();
    camera.stop();
    const [stream] = fake.streams;
    expect(stream.getTracks().every((t) => t.stopped)).toBe(true);
    expect(stream.released).toBe(true);
  });

  it('falha ao abrir chega a quem pediu', async () => {
    fake.cameraError = new Error('câmera ocupada');
    await expect(media.openCamera()).rejects.toThrow('câmera ocupada');
  });
});

describe('conexão com quem assiste', () => {
  it('cada conexão usa os servidores recebidos e leva a imagem da câmera', async () => {
    const camera = await media.openCamera();
    camera.connect(options());
    const [peer] = fake.peers;
    const [stream] = fake.streams;
    expect(peer.config).toEqual({ iceServers: [{ urls: 'stun:stun.example.org:3478' }] });
    expect(peer.added).toEqual([{ track: stream.getTracks()[0], streams: [stream] }]);
  });

  it('a oferta vira a descrição local e o SDP volta para quem pediu', async () => {
    const camera = await media.openCamera();
    const conn = camera.connect(options());
    await expect(conn.offer()).resolves.toBe('oferta-1');
    expect(fake.peers[0].localDescription).toEqual({ type: 'offer', sdp: 'oferta-1' });
  });

  it('a resposta do painel vira a descrição remota', async () => {
    const camera = await media.openCamera();
    const conn = camera.connect(options());
    await conn.acceptAnswer('resposta');
    expect(fake.peers[0].remoteDescription).toEqual(
      expect.objectContaining({ type: 'answer', sdp: 'resposta' }),
    );
  });

  it('candidato do painel entra na conexão com os mesmos campos', async () => {
    const camera = await media.openCamera();
    const conn = camera.connect(options());
    await conn.addCandidate({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 });
    expect(fake.peers[0].candidates).toEqual([
      expect.objectContaining({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 }),
    ]);
  });

  it('candidato achado aqui sai só com os campos do protocolo; o fim da coleta não sai', async () => {
    const onCandidate = jest.fn();
    const camera = await media.openCamera();
    camera.connect(options({ onCandidate }));
    fake.peers[0].emitCandidate({ candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 });
    fake.peers[0].emitCandidate({ candidate: 'candidate:3' });
    fake.peers[0].emitCandidate(null);
    expect(onCandidate.mock.calls).toEqual([
      [{ candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 }],
      [{ candidate: 'candidate:3', sdpMid: null, sdpMLineIndex: null }],
    ]);
  });

  it('conexão que falha avisa; os outros estados não', async () => {
    const onFailed = jest.fn();
    const camera = await media.openCamera();
    camera.connect(options({ onFailed }));
    fake.peers[0].emitConnectionState('connecting');
    fake.peers[0].emitConnectionState('disconnected');
    expect(onFailed).not.toHaveBeenCalled();
    fake.peers[0].emitConnectionState('failed');
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('fechar encerra a conexão e cala os avisos dela', async () => {
    const onCandidate = jest.fn();
    const onFailed = jest.fn();
    const camera = await media.openCamera();
    const conn = camera.connect(options({ onCandidate, onFailed }));
    conn.close();
    expect(fake.peers[0].closed).toBe(true);
    fake.peers[0].emitCandidate({ candidate: 'candidate:4' });
    fake.peers[0].emitConnectionState('failed');
    expect(onCandidate).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('fechar uma conexão não desliga a câmera das outras', async () => {
    const camera = await media.openCamera();
    camera.connect(options()).close();
    expect(fake.streams[0].getTracks().some((t) => t.stopped)).toBe(false);
  });
});
