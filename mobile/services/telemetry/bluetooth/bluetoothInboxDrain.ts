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

/** O que fica em arquivo entre uma rodada e outra. */
interface DrainState {
  /** Jornada dona da sessão: `userId|startedAt` da janela. */
  journeyKey: string;
  sessionId: string;
  /** Hora (ms) da última leitura aceita; null antes da primeira. */
  lastAcceptedAt: number | null;
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

function parseState(text: string | null): DrainState | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { journeyKey, sessionId, lastAcceptedAt } = parsed as Record<string, unknown>;
  if (typeof journeyKey !== 'string' || typeof sessionId !== 'string') return null;
  const last = typeof lastAcceptedAt === 'number' && Number.isFinite(lastAcceptedAt) ? lastAcceptedAt : null;
  return { journeyKey, sessionId, lastAcceptedAt: last };
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
  async function readState(): Promise<DrainState | null> {
    try {
      return parseState(await deps.state.read());
    } catch {
      return null;
    }
  }

  async function writeState(state: DrainState | null): Promise<void> {
    try {
      await deps.state.write(state ? JSON.stringify(state) : '');
    } catch (error) {
      // As amostras já estão na fila; perder o arquivo custa no máximo uma
      // sessão nova ou uma leitura a mais dentro dos 5 s.
      warn('estado não gravado', error);
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
    // Tirar da caixa primeiro: o que sai daqui vai para a fila durável na
    // mesma rodada, e uma rodada que falhe adiante já não depende do Kotlin.
    const readings = [...deps.ble.rotateReadings()].sort((a, b) => a.receivedAt - b.receivedAt);
    const now = deps.now();
    const window = await deps.window.read();
    const open = isWindowOpen(window, now);
    const stored = await readState();

    let session: DrainState | null = stored;
    if (window) {
      const journeyKey = `${window.userId}|${window.startedAt}`;
      if (stored?.journeyKey !== journeyKey) {
        // Jornada nova: sessão nova, sem herdar a vez da última aceita. O
        // contador da anterior sai da fila quando o último evento dela sair.
        if (stored) await deps.outbox.forgetSession(stored.sessionId);
        session = { journeyKey, sessionId: deps.uuidV4(), lastAcceptedAt: null };
      }
    }

    // Janela fechada (fim da jornada ou logout): o que chegou até aqui é da
    // sessão guardada. Sem sessão guardada não há a quem atribuir.
    const startedAt = window ? Date.parse(window.startedAt) : Number.NEGATIVE_INFINITY;
    const cap = window ? startedAt + TRACKING_MAX_MS : Number.POSITIVE_INFINITY;
    const events: OutboxEvent[] = [];
    if (session) {
      let last = session.lastAcceptedAt;
      for (const reading of readings) {
        if (reading.receivedAt < startedAt || reading.receivedAt >= cap) continue;
        if (last !== null && reading.receivedAt - last < BLE_SAMPLE_SPACING_MS) continue;
        const bpm = bpmOf(reading);
        if (bpm === null) continue;
        events.push({
          eventId: deps.uuidV4(),
          monitoringSessionId: session.sessionId,
          sequence: await deps.outbox.nextSequence(session.sessionId),
          eventTime: new Date(reading.receivedAt).toISOString(),
          origin: 'REAL',
          measurements: { heartRate: { value: bpm, unit: 'bpm', source: 'BLUETOOTH_HR' } },
        });
        last = reading.receivedAt;
      }
      if (events.length > 0) await deps.outbox.appendMany(events);
      session = { ...session, lastAcceptedAt: last };
    }
    // A sessão acaba com a janela; vencida (12 h), a janela ainda existe e a
    // sessão fica, para uma rodada atrasada não abrir outra à toa.
    await writeState(window ? session : null);

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
