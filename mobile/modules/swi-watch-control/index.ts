import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type {
  HeartRateSampleEvent,
  SwiWatchControlStatus,
  WatchControl,
  WatchControlNative,
} from './src/SwiWatchControl.types';

// Tipos e o leitor de código de erro, para os serviços importarem de um lugar só.
export * from './src/SwiWatchControl.types';

// O módulo só existe compilado em iOS (EAS/TestFlight). Em Android, web,
// Expo Go e Jest ele não está registrado e a função devolve null: o app
// segue funcionando e a tela diagnóstica diz "sem suporte" em vez de quebrar.
export function loadNativeWatchControl(platformOS: string): WatchControlNative | null {
  if (platformOS !== 'ios') return null;
  return requireOptionalNativeModule<WatchControlNative>('SwiWatchControl');
}

// Ausência nunca vira número: uma amostra sem BPM finito e positivo, ou sem
// horário válido, é descartada antes de chegar a qualquer tela.
function sanitizeSample(raw: HeartRateSampleEvent | null | undefined): HeartRateSampleEvent | null {
  if (!raw) return null;
  const { bpm, measuredAt } = raw;
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) return null;
  if (typeof measuredAt !== 'string' || measuredAt === '' || Number.isNaN(Date.parse(measuredAt))) {
    return null;
  }
  return { bpm, measuredAt };
}

function normalize(raw: SwiWatchControlStatus): SwiWatchControlStatus {
  return {
    session: raw.session ?? 'none',
    sessionChangedAt: raw.sessionChangedAt ?? null,
    lastSample: sanitizeSample(raw.lastSample),
    // Só os dois valores do contrato passam: qualquer outra coisa vinda do
    // nativo é tratada como "ainda não sei", que é a verdade.
    watchProtocol:
      raw.watchProtocol === 'v1' || raw.watchProtocol === 'legacy' ? raw.watchProtocol : null,
  };
}

const UNSUPPORTED: WatchControl = {
  supported: false,
  getStatus: () => null,
  requestAuthorization: async () => false,
  startMonitoring: async () => false,
  subscribe: () => () => undefined,
  // Rejeita em vez de resolver um status inventado: sem módulo não houve
  // requisição, e um 0 ou 503 fabricado se confundiria com resposta real.
  request: async () => {
    throw Object.assign(new Error('Módulo nativo indisponível nesta plataforma'), {
      code: 'E_UNSUPPORTED',
    });
  },
  // Inerte, e não uma lista inventada: sem módulo não há arquivo para drenar.
  rotateInbox: () => [],
  hasDeviceCredential: () => false,
  clearDeviceCredential: () => undefined,
};

export function createWatchControl(native: WatchControlNative | null): WatchControl {
  if (!native) return UNSUPPORTED;
  return {
    supported: true,
    getStatus: () => normalize(native.getStatus()),
    requestAuthorization: () => native.requestAuthorization(),
    async startMonitoring() {
      // Com a sessão espelhada já ativa, pedir outra faria o relógio recusar.
      // A guarda vive aqui, e não no Swift, para a tela ter um caminho só.
      if (normalize(native.getStatus()).session === 'running') return true;
      try {
        return await native.startMonitoring();
      } catch {
        // Recusa do sistema é resposta, não exceção: a tela lê o estado
        // derivado depois e mostra indisponível se nada chegar.
        return false;
      }
    },
    subscribe(listener) {
      let status = normalize(native.getStatus());
      const session = native.addListener('onMirroredSessionChanged', (event) => {
        status = { ...status, session: event.state, sessionChangedAt: event.changedAt };
        listener(status);
      });
      const sample = native.addListener('onHeartRateSample', (event) => {
        const clean = sanitizeSample(event);
        if (!clean) return;
        status = { ...status, lastSample: clean };
        listener(status);
      });
      return () => {
        session.remove();
        sample.remove();
      };
    },
    // Sem try/catch de propósito: o código da rejeição é a informação, e cada
    // serviço mapeia para o próprio motivo.
    request: (url, method, body, auth, storeCredential) =>
      native.request(url, method, body, auth, storeCredential),
    // Uma falha aqui não pode derrubar o dreno nem o envio: sem arquivo
    // rotacionado, o dreno simplesmente não tem o que fazer nesta rodada.
    rotateInbox: () => {
      try {
        const files = native.rotateInbox();
        return Array.isArray(files) ? files.filter((f) => typeof f === 'string') : [];
      } catch {
        return [];
      }
    },
    hasDeviceCredential: () => native.hasDeviceCredential(),
    clearDeviceCredential: () => native.clearDeviceCredential(),
  };
}

export const watchControl: WatchControl = createWatchControl(loadNativeWatchControl(Platform.OS));
