import type { BleHeartRate, RawHeartRateReading } from '../../../modules/swi-ble-heart-rate/src';
import type { WatchControl } from '../../../modules/swi-watch-control';
import type { OutboxEvent, OutboxStorage, TelemetryOutbox } from '../telemetryOutbox';
import { MAX_DRAIN_ROUNDS, shouldDrainAgain, type TelemetryUploader, type UploadOutcome } from '../telemetryUploader';
import type { BandChoice } from './bluetoothBandChoice';
import { decodeBase64, parseHeartRateMeasurement } from './heartRateMeasurement';

// O que a tarefa sem interface faz a cada vez que o serviço da pulseira a
// acorda (a cada 15 s com leitura nova, também com a tela apagada). Roda sem
// React e às vezes num processo que o sistema acabou de relançar: tudo o que
// ela precisa (qual a pulseira escolhida, qual a sessão, quando foi a última
// leitura aceita, como enviar) vem de arquivo.
//
// A sessão de monitoramento segue a escolha da pulseira (bluetoothBandChoice.ts):
// nasce na primeira rodada depois de escolher, e acaba ao encerrar (escolha
// apagada, também no logout), ao trocar de pulseira e sem a credencial do
// aparelho (pareamento revogado). A jornada não entra aqui, nem há prazo.

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
 * Teto das leituras à espera da fila, só para a memória: 12 h a uma a cada
 * 5 s. Só chega perto disso com a fila falhando horas a fio; passado o teto,
 * as mais antigas saem primeiro. Não para o serviço.
 */
export const BLE_PENDING_MAX = (12 * 60 * 60 * 1000) / BLE_SAMPLE_SPACING_MS;

/** Leitura aceita que ainda não entrou na fila de envio. */
interface PendingSample {
  sessionId: string;
  receivedAt: number;
  bpm: number;
}

/** A sessão de monitoramento da pulseira escolhida. */
interface DrainSession {
  /** Escolha dona da sessão: `deviceId|chosenAt`. */
  key: string;
  sessionId: string;
  /** Hora (ms) da escolha: o que chegou antes não é desta sessão. */
  since: number;
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
  /** A escolha guardada; rejeita se o disco falhar. */
  choice: { read(): Promise<BandChoice | null> };
  state: OutboxStorage;
  outbox: Pick<TelemetryOutbox, 'appendMany' | 'nextSequence' | 'forgetSession' | 'pending' | 'remove'>;
  uploader: TelemetryUploader;
  control: Pick<WatchControl, 'hasDeviceCredential'>;
  uuidV4(): string;
}

export interface BluetoothInboxDrain {
  /** Uma rodada. Nunca rejeita. Com uma em curso, devolve a mesma promessa. */
  run(): Promise<void>;
  /**
   * Pareamento novo: o backend criou outro aparelho e recusa as sessões do
   * anterior. Cada sessão que ainda tem o que mandar (a corrente, as leituras
   * à espera, os eventos da pulseira na fila) troca por uma sessão nova, com
   * as mesmas leituras. Espera a rodada em curso. Nunca rejeita.
   */
  resetForNewPairing(): Promise<void>;
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
  const { key, sessionId, since, lastAcceptedAt } = value;
  if (typeof key !== 'string' || typeof sessionId !== 'string') return null;
  return {
    key,
    sessionId,
    since: isFiniteNumber(since) ? since : 0,
    lastAcceptedAt: isFiniteNumber(lastAcceptedAt) ? lastAcceptedAt : null,
  };
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

const keyOf = (choice: BandChoice) => `${choice.deviceId}|${choice.chosenAt ?? 0}`;

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

  /**
   * A escolha dona da sessão agora: null quando não há sessão a manter
   * (encerrada, sem credencial); undefined quando não deu para ler a escolha,
   * e aí nada muda, nem a sessão nem o serviço.
   */
  async function target(credential: boolean): Promise<{ key: string; since: number } | null | undefined> {
    if (!credential) return null;
    let choice: BandChoice | null;
    try {
      choice = await deps.choice.read();
    } catch (error) {
      warn('escolha da pulseira não lida', error);
      return undefined;
    }
    return choice === null ? null : { key: keyOf(choice), since: choice.chosenAt ?? 0 };
  }

  async function round(): Promise<void> {
    // A caixa entrega cada leitura uma vez só: daqui em diante, o que for
    // aceito vai para o arquivo de estado antes de tentar a fila.
    const readings = [...deps.ble.rotateReadings()].sort((a, b) => a.receivedAt - b.receivedAt);
    const credential = deps.control.hasDeviceCredential();
    const owner = await target(credential);
    const stored = await readState();

    // A sessão que acaba nesta rodada (encerrada, pulseira trocada, aparelho
    // despareado) ainda leva o que chegou antes do fim. Pareado de novo, o
    // aparelho é outro, e a sessão também: por isso ela não sobrevive à
    // credencial ausente.
    let session = stored.session ? { ...stored.session } : null;
    let closing: DrainSession | null = null;
    if (owner !== undefined && session?.key !== owner?.key) {
      closing = session;
      session = null;
    }
    if (owner && !session) {
      // Escolha nova: sessão nova, sem herdar a vez da última aceita.
      session = { key: owner.key, sessionId: deps.uuidV4(), since: owner.since, lastAcceptedAt: null };
    }

    const fresh: PendingSample[] = [];
    for (const reading of readings) {
      const into = session && reading.receivedAt >= session.since ? session : closing;
      if (!into) continue;
      const last = into.lastAcceptedAt;
      if (last !== null && reading.receivedAt - last < BLE_SAMPLE_SPACING_MS) continue;
      const bpm = bpmOf(reading);
      if (bpm === null) continue;
      fresh.push({ sessionId: into.sessionId, receivedAt: reading.receivedAt, bpm });
      into.lastAcceptedAt = reading.receivedAt;
    }

    // Passado o teto, as mais antigas saem primeiro.
    const waiting = [...stored.pending, ...fresh].slice(-BLE_PENDING_MAX);
    if (fresh.length > 0) await writeState({ session, pending: waiting });
    const pending = await enqueue(waiting);
    await writeState({ session, pending });

    // Sessões que acabaram. O contador delas sai da fila quando nada delas
    // esperar mais aqui; com evento ainda na fila, sai com o último
    // (forgetSession).
    const forgetEnded = async () => {
      const ended = new Set<string>(waiting.map((sample) => sample.sessionId));
      if (closing) ended.add(closing.sessionId);
      if (session) ended.delete(session.sessionId);
      for (const sessionId of ended) {
        if (!pending.some((sample) => sample.sessionId === sessionId)) await forgetSession(sessionId);
      }
    };

    if (credential) {
      let outcome: UploadOutcome | null = null;
      try {
        outcome = await upload();
      } catch (error) {
        // O uploader não deveria lançar; se lançar, a fila segue intacta.
        warn('envio falhou', error);
      }
      // Credencial recusada: o aparelho foi despareado. Nada mais sobe daqui,
      // a sessão acaba com ele e o serviço não tem por que seguir conectado.
      if (outcome?.outcome === 'unpaired') {
        if (session) {
          closing = session;
          session = null;
          await writeState({ session, pending });
        }
        await forgetEnded();
        await stopService();
        return;
      }
    }

    await forgetEnded();
    if (owner === null) await stopService();
  }

  async function resetForNewPairing(): Promise<void> {
    const stored = await readState();
    // Os eventos da pulseira na fila, de qualquer sessão: depois do pareamento
    // nenhuma sessão anterior vale mais, nem a fechada pelo 401 ou pela
    // credencial ausente. Fila ilegível ainda deixa trocar o que está aqui.
    let queued: OutboxEvent[] = [];
    try {
      queued = (await deps.outbox.pending()).filter(
        (event) => event.measurements.heartRate?.source === 'BLUETOOTH_HR',
      );
    } catch (error) {
      warn('fila não lida no pareamento novo', error);
    }

    // Uma sessão nova para cada sessão velha, e não uma só para tudo: a de
    // uma pulseira encerrada continua fechada, só que com outro número.
    const renamed = new Map<string, string>();
    const rename = (sessionId: string) => {
      let next = renamed.get(sessionId);
      if (next === undefined) {
        next = deps.uuidV4();
        renamed.set(sessionId, next);
      }
      return next;
    };
    const session = stored.session ? { ...stored.session, sessionId: rename(stored.session.sessionId) } : null;
    // O evento volta a ser leitura à espera, com outro id e outra sequência:
    // o backend nunca o aceitou, porque a sessão dele é do aparelho anterior.
    const fromQueue = queued.flatMap((event): PendingSample[] => {
      const bpm = event.measurements.heartRate?.value;
      const receivedAt = Date.parse(event.eventTime);
      if (bpm === undefined || Number.isNaN(receivedAt)) return [];
      return [{ sessionId: rename(event.monitoringSessionId), receivedAt, bpm }];
    });
    const waiting = [
      ...stored.pending.map((sample) => ({ ...sample, sessionId: rename(sample.sessionId) })),
      ...fromQueue,
    ]
      .sort((a, b) => a.receivedAt - b.receivedAt)
      .slice(-BLE_PENDING_MAX);
    if (renamed.size === 0) return;

    // Como na rodada: o arquivo de estado antes da fila. Se a remoção falhar,
    // o evento velho fica e volta recusado; a leitura sobe pela sessão nova.
    await writeState({ session, pending: waiting });
    if (queued.length > 0) {
      try {
        await deps.outbox.remove(queued.map((event) => event.eventId));
      } catch (error) {
        warn('eventos da sessão anterior não saíram da fila', error);
      }
    }
    const pending = await enqueue(waiting);
    await writeState({ session, pending });

    for (const [old, next] of renamed) {
      await forgetSession(old);
      // A sessão nova de uma sessão fechada nunca mais recebe leitura: o
      // contador sai com o último evento dela.
      if (next !== session?.sessionId && !pending.some((sample) => sample.sessionId === next)) {
        await forgetSession(next);
      }
    }
  }

  // A rodada e o reset mexem no mesmo arquivo de estado e nas mesmas sessões:
  // um espera o outro terminar.
  let tail: Promise<void> = Promise.resolve();
  const exclusive = (task: () => Promise<void>, what: string) => {
    const next = tail.then(task).catch((error: unknown) => warn(what, error));
    tail = next;
    return next;
  };
  let inFlight: Promise<void> | null = null;

  return {
    run() {
      inFlight ??= exclusive(round, 'rodada falhou').finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    resetForNewPairing: () => exclusive(resetForNewPairing, 'reset do pareamento novo falhou'),
  };
}
