import type { BleHeartRate, RawHeartRateReading } from '../../../modules/swi-ble-heart-rate/src';
import type { WatchControl } from '../../../modules/swi-watch-control';
import { isWindowOpen, TRACKING_MAX_MS, type TrackingWindowStore } from '../../positions/trackingWindow';
import type { OutboxEvent, OutboxStorage, TelemetryOutbox } from '../telemetryOutbox';
import { MAX_DRAIN_ROUNDS, shouldDrainAgain, type TelemetryUploader, type UploadOutcome } from '../telemetryUploader';
import { decodeBase64, parseHeartRateMeasurement } from './heartRateMeasurement';

// O que a tarefa sem interface faz a cada vez que o serviço da pulseira a
// acorda (a cada 15 s com leitura nova, também com a tela apagada). Roda sem
// React e às vezes num processo que o sistema acabou de relançar: tudo o que
// ela precisa (de quem é a jornada, qual a sessão, quando foi a última
// leitura aceita, como enviar) vem de arquivo.
//
// A jornada é a janela do rastreio (trackingWindow.ts), a mesma que o GPS
// usa: ela abre com a jornada, fecha no fim dela e no logout, e vence em
// 12 h. Aqui ela só é lida.

/** Nome da tarefa no AppRegistry; o Kotlin (BleDrainTaskService) usa o mesmo. */
export const BLE_DRAIN_TASK_NAME = 'SwiBleHeartRateDrain';

/**
 * Espaço mínimo entre duas leituras aceitas. A pulseira notifica uma vez por
 * segundo; o relógio manda uma a cada 5 s, e as regras de alerta (janela de
 * 60 s, buraco máximo de 15 s) foram feitas para esse ritmo.
 */
export const BLE_SAMPLE_SPACING_MS = 5_000;

/** Faixa que o backend aceita para batimento; fora dela a leitura é ruído. */
export const BLE_HEART_RATE_MIN_BPM = 20;
export const BLE_HEART_RATE_MAX_BPM = 300;

export const BLE_DRAIN_STATE_FILE_NAME = 'ble-heart-rate-drain.v1.json';

/**
 * Teto das leituras à espera da fila: 12 h de jornada a uma a cada 5 s. Só
 * chega perto disso com a fila falhando a jornada inteira.
 */
export const BLE_PENDING_MAX = TRACKING_MAX_MS / BLE_SAMPLE_SPACING_MS;

/** Leitura aceita que ainda não entrou na fila de envio. */
interface PendingSample {
  sessionId: string;
  receivedAt: number;
  bpm: number;
}

/** A sessão da jornada. */
interface DrainSession {
  /** Jornada dona da sessão: `userId|startedAt` da janela. */
  journeyKey: string;
  sessionId: string;
  /** Hora (ms) da última leitura aceita; null antes da primeira. */
  lastAcceptedAt: number | null;
}

/**
 * O que fica em arquivo entre uma rodada e outra. A caixa do Kotlin entrega
 * cada leitura uma vez só: o que foi aceito fica aqui até a fila o receber,
 * para uma fila que falhe não levar as leituras junto.
 */
interface DrainState {
  session: DrainSession | null;
  pending: PendingSample[];
}

export interface BluetoothInboxDrainDeps {
  ble: Pick<BleHeartRate, 'rotateReadings' | 'stop'>;
  window: Pick<TrackingWindowStore, 'read'>;
  state: OutboxStorage;
  outbox: Pick<TelemetryOutbox, 'appendMany' | 'nextSequence' | 'forgetSession'>;
  uploader: TelemetryUploader;
  control: Pick<WatchControl, 'hasDeviceCredential'>;
  now(): Date;
  uuidV4(): string;
}

export interface BluetoothInboxDrain {
  /** Uma rodada. Nunca rejeita. Com uma em curso, devolve a mesma promessa. */
  run(): Promise<void>;
}

const warn = (what: string, error: unknown) =>
  console.warn(
    `[bluetoothInboxDrain] ${what}: ${String((error as { message?: unknown })?.message ?? error)}`,
  );

const EMPTY_STATE: DrainState = { session: null, pending: [] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseSession(value: unknown): DrainSession | null {
  if (!isRecord(value)) return null;
  const { journeyKey, sessionId, lastAcceptedAt } = value;
  if (typeof journeyKey !== 'string' || typeof sessionId !== 'string') return null;
  return { journeyKey, sessionId, lastAcceptedAt: isFiniteNumber(lastAcceptedAt) ? lastAcceptedAt : null };
}

function parsePending(value: unknown): PendingSample[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PendingSample =>
      isRecord(item) &&
      typeof item.sessionId === 'string' &&
      isFiniteNumber(item.receivedAt) &&
      isFiniteNumber(item.bpm),
  );
}

function parseState(text: string | null): DrainState {
  if (!text) return EMPTY_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return EMPTY_STATE;
  }
  if (!isRecord(parsed)) return EMPTY_STATE;
  return { session: parseSession(parsed.session), pending: parsePending(parsed.pending) };
}

/** O batimento da leitura, ou null se ela não deve virar amostra. */
function bpmOf(reading: RawHeartRateReading): number | null {
  const bytes = decodeBase64(reading.bytes);
  if (bytes === null) return null;
  const measurement = parseHeartRateMeasurement(bytes);
  if (measurement === null) return null;
  // Só descarta por contato quando o sensor diz que sabe medir contato e não
  // achou pele: sem esse suporte, o bit de contato não significa nada.
  if (measurement.contact === 'notDetected') return null;
  const { bpm } = measurement;
  if (bpm < BLE_HEART_RATE_MIN_BPM || bpm > BLE_HEART_RATE_MAX_BPM) return null;
  return bpm;
}

export function createBluetoothInboxDrain(deps: BluetoothInboxDrainDeps): BluetoothInboxDrain {
  async function readState(): Promise<DrainState> {
    try {
      return parseState(await deps.state.read());
    } catch {
      return EMPTY_STATE;
    }
  }

  async function writeState(state: DrainState): Promise<void> {
    const empty = state.session === null && state.pending.length === 0;
    try {
      await deps.state.write(empty ? '' : JSON.stringify(state));
    } catch (error) {
      // Perder o arquivo custa no máximo uma sessão nova ou uma leitura a mais
      // dentro dos 5 s; as leituras à espera da fila seguem só nesta rodada.
      warn('estado não gravado', error);
    }
  }

  /** Põe na fila de envio o que espera. Devolve o que não entrou. */
  async function enqueue(pending: PendingSample[]): Promise<PendingSample[]> {
    if (pending.length === 0) return pending;
    try {
      const events: OutboxEvent[] = [];
      for (const sample of pending) {
        events.push({
          eventId: deps.uuidV4(),
          monitoringSessionId: sample.sessionId,
          sequence: await deps.outbox.nextSequence(sample.sessionId),
          eventTime: new Date(sample.receivedAt).toISOString(),
          origin: 'REAL',
          measurements: { heartRate: { value: sample.bpm, unit: 'bpm', source: 'BLUETOOTH_HR' } },
        });
      }
      await deps.outbox.appendMany(events);
      return [];
    } catch (error) {
      // Tudo fica para a próxima rodada. Sequência tirada e não usada só deixa
      // um buraco na numeração da sessão.
      warn('fila não recebeu as leituras', error);
      return pending;
    }
  }

  async function forgetSession(sessionId: string): Promise<void> {
    try {
      await deps.outbox.forgetSession(sessionId);
    } catch (error) {
      warn('contador da sessão não esquecido', error);
    }
  }

  async function stopService(): Promise<void> {
    try {
      await deps.ble.stop();
    } catch (error) {
      warn('serviço não parou', error);
    }
  }

  async function upload(): Promise<UploadOutcome | null> {
    let last: UploadOutcome | null = null;
    for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
      last = await deps.uploader.uploadPending();
      if (!shouldDrainAgain(last)) break;
    }
    return last;
  }

  async function round(): Promise<void> {
    // A caixa entrega cada leitura uma vez só: daqui em diante, o que for
    // aceito vai para o arquivo de estado antes de tentar a fila.
    const readings = [...deps.ble.rotateReadings()].sort((a, b) => a.receivedAt - b.receivedAt);
    const now = deps.now();
    const window = await deps.window.read();
    const open = isWindowOpen(window, now);
    const stored = await readState();

    // Sessões que acabaram (jornada nova ou encerrada). O contador delas sai
    // da fila quando nada delas esperar mais aqui; com evento ainda na fila,
    // sai com o último (forgetSession).
    const ended = new Set<string>();
    let session = stored.session;
    if (window) {
      const journeyKey = `${window.userId}|${window.startedAt}`;
      if (session?.journeyKey !== journeyKey) {
        // Jornada nova: sessão nova, sem herdar a vez da última aceita.
        if (session) ended.add(session.sessionId);
        session = { journeyKey, sessionId: deps.uuidV4(), lastAcceptedAt: null };
      }
    }

    // Janela fechada (fim da jornada ou logout): o que chegou até aqui é da
    // sessão guardada. Sem sessão guardada não há a quem atribuir.
    const startedAt = window ? Date.parse(window.startedAt) : Number.NEGATIVE_INFINITY;
    const cap = window ? startedAt + TRACKING_MAX_MS : Number.POSITIVE_INFINITY;
    const fresh: PendingSample[] = [];
    if (session) {
      let last = session.lastAcceptedAt;
      for (const reading of readings) {
        if (reading.receivedAt < startedAt || reading.receivedAt >= cap) continue;
        if (last !== null && reading.receivedAt - last < BLE_SAMPLE_SPACING_MS) continue;
        const bpm = bpmOf(reading);
        if (bpm === null) continue;
        fresh.push({ sessionId: session.sessionId, receivedAt: reading.receivedAt, bpm });
        last = reading.receivedAt;
      }
      session = { ...session, lastAcceptedAt: last };
    }
    // A sessão acaba com a janela; vencida (12 h), a janela ainda existe e a
    // sessão fica, para uma rodada atrasada não abrir outra à toa.
    if (!window && session) {
      ended.add(session.sessionId);
      session = null;
    }

    // Passado o teto, as mais antigas saem primeiro.
    const waiting = [...stored.pending, ...fresh].slice(-BLE_PENDING_MAX);
    if (fresh.length > 0) await writeState({ session, pending: waiting });
    const pending = await enqueue(waiting);
    await writeState({ session, pending });

    for (const sample of waiting) ended.add(sample.sessionId);
    if (session) ended.delete(session.sessionId);
    for (const sessionId of ended) {
      if (!pending.some((sample) => sample.sessionId === sessionId)) await forgetSession(sessionId);
    }

    if (deps.control.hasDeviceCredential()) {
      let outcome: UploadOutcome | null = null;
      try {
        outcome = await upload();
      } catch (error) {
        // O uploader não deveria lançar; se lançar, a fila segue intacta.
        warn('envio falhou', error);
      }
      // Credencial recusada: o aparelho foi despareado. Nada mais sobe daqui,
      // e o serviço não tem por que seguir conectado.
      if (outcome?.outcome === 'unpaired') {
        await stopService();
        return;
      }
    }

    if (!open) await stopService();
  }

  let inFlight: Promise<void> | null = null;

  return {
    run() {
      inFlight ??= round()
        .catch((error: unknown) => warn('rodada falhou', error))
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
