import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type {
  HealthReading,
  HealthReadingsNative,
  HealthReadingsSource,
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

// O mesmo regex da fila (telemetryOutbox): o identificador da amostra vira o
// identificador do evento, e a fila recusa o que não for UUID.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// O Swift entrega dicionário sem tipo. Só passa o que tem a forma do contrato:
// uma medição torta é descartada aqui, e não vira número inventado adiante.
function sanitizeHealthReading(raw: unknown): HealthReading | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { kind, id, measuredAt, systolic, diastolic, celsius, userEntered } = raw as Record<
    string,
    unknown
  >;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (typeof measuredAt !== 'string' || Number.isNaN(Date.parse(measuredAt))) return null;
  const base = { id: id.toLowerCase(), measuredAt, userEntered: userEntered === true };
  if (kind === 'bloodPressure') {
    if (!isFiniteNumber(systolic) || !isFiniteNumber(diastolic)) return null;
    return { kind, ...base, systolic, diastolic };
  }
  if (kind === 'bodyTemperature') {
    if (!isFiniteNumber(celsius)) return null;
    return { kind, ...base, celsius };
  }
  return null;
}

const NO_HEALTH_READINGS: HealthReadingsSource = { supported: false, read: async () => [] };

/**
 * Leitura do app Saúde (pressão e temperatura). Separada do `WatchControl` de
 * propósito: não tem a ver com a sessão espelhada do relógio, e um binário
 * sem a função nova segue funcionando, só sem estas duas medições.
 */
export function createHealthReadingsSource(
  native: Partial<HealthReadingsNative> | null,
): HealthReadingsSource {
  if (!native || typeof native.readHealthReadings !== 'function') return NO_HEALTH_READINGS;
  const readNative = native.readHealthReadings.bind(native);
  return {
    supported: true,
    async read(sinceMs) {
      try {
        const raw = await readNative(sinceMs);
        if (!Array.isArray(raw)) return [];
        return raw.flatMap((item) => {
          const reading = sanitizeHealthReading(item);
          return reading === null ? [] : [reading];
        });
      } catch {
        // Leitura negada, banco de saúde trancado com o iPhone bloqueado ou iOS
        // sem HealthKit: não há medição a mandar, e o envio do resto segue.
        return [];
      }
    },
  };
}

const nativeModule = loadNativeWatchControl(Platform.OS);

export const watchControl: WatchControl = createWatchControl(nativeModule);

export const healthReadingsSource: HealthReadingsSource = createHealthReadingsSource(nativeModule);
