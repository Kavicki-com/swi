import type { RawHeartRateReading } from '../../../modules/swi-ble-heart-rate/src';
import { createTelemetryOutbox, type OutboxStorage } from '../telemetryOutbox';
import type { UploadOutcome } from '../telemetryUploader';
import type { BandChoice } from './bluetoothBandChoice';
import {
  BLE_PENDING_MAX,
  BLE_SAMPLE_SPACING_MS,
  createBluetoothInboxDrain,
  type BluetoothInboxDrainDeps,
} from './bluetoothInboxDrain';

// Dublê de arquivo: o mesmo texto entre duas fábricas é o reinício do processo.
function memoryStorage(initial: string | null = null) {
  let text = initial;
  const storage: OutboxStorage = {
    read: jest.fn(async () => text),
    write: jest.fn(async (next: string) => {
      text = next;
    }),
  };
  return { storage, current: () => text };
}

// Um contador só para o arquivo: duas fábricas no mesmo teste são dois
// processos, e um processo novo nunca repete um UUID do anterior.
let counter = 0;

const T0 = Date.parse('2026-10-22T10:00:00.000Z');
const POLAR: BandChoice = { deviceId: 'A0:9E:1A:00:00:01', name: 'Polar H10', chosenAt: T0 - 60_000 };
const OUTRA: BandChoice = { deviceId: 'B0:00:00:00:00:02', name: null, chosenAt: T0 + 1000 };

// Notificação no formato do 0x2A37, em base64 como o Kotlin guarda.
const b64 = (...values: number[]) => Buffer.from(values).toString('base64');
const hr = (bpm: number) => b64(0x00, bpm);
const CONTACT_SUPPORTED = 0b100;
const CONTACT_DETECTED = 0b010;
const reading = (offsetMs: number, bytes = hr(80)): RawHeartRateReading => ({
  bytes,
  receivedAt: T0 + offsetMs,
});

function setup(
  opts: {
    choice?: BandChoice | null | Error;
    credential?: boolean;
    outcomes?: UploadOutcome[];
    stateStorage?: ReturnType<typeof memoryStorage>;
    outboxStorage?: ReturnType<typeof memoryStorage>;
  } = {},
) {
  const inbox: RawHeartRateReading[][] = [];
  const ble = {
    rotateReadings: jest.fn(() => inbox.shift() ?? []),
    stop: jest.fn(async () => undefined),
  };
  const choice = opts.choice === undefined ? POLAR : opts.choice;
  const stateStorage = opts.stateStorage ?? memoryStorage();
  const outboxStorage = opts.outboxStorage ?? memoryStorage();
  const outbox = createTelemetryOutbox(outboxStorage.storage);
  const outcomes = [...(opts.outcomes ?? [])];
  const uploader = {
    uploadPending: jest.fn(async (): Promise<UploadOutcome> => outcomes.shift() ?? { outcome: 'idle' }),
  };
  const deps: BluetoothInboxDrainDeps = {
    ble,
    choice: {
      read: jest.fn(async () => {
        if (choice instanceof Error) throw choice;
        return choice;
      }),
    },
    state: stateStorage.storage,
    outbox,
    uploader,
    control: { hasDeviceCredential: () => opts.credential ?? true },
    uuidV4: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    },
  };
  const drain = createBluetoothInboxDrain(deps);
  const push = (...readings: RawHeartRateReading[]) => inbox.push(readings);
  return { drain, push, ble, outbox, uploader, stateStorage, outboxStorage, deps };
}

const times = (events: readonly { eventTime: string }[]) =>
  events.map((e) => Date.parse(e.eventTime) - T0);

describe('bluetoothInboxDrain', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('enfileira o batimento com origem BLUETOOTH_HR, hora do recebimento e envia', async () => {
    const { drain, push, outbox, uploader } = setup();
    push(reading(0, hr(92)));
    await drain.run();
    const [event] = await outbox.pending();
    expect(event).toEqual({
      eventId: expect.any(String),
      monitoringSessionId: expect.any(String),
      sequence: 0,
      eventTime: '2026-10-22T10:00:00.000Z',
      origin: 'REAL',
      measurements: { heartRate: { value: 92, unit: 'bpm', source: 'BLUETOOTH_HR' } },
    });
    expect(event.eventId).not.toBe(event.monitoringSessionId);
    expect(uploader.uploadPending).toHaveBeenCalledTimes(1);
  });

  it('reduz para uma leitura a cada 5 s', async () => {
    const { drain, push, outbox } = setup();
    push(...Array.from({ length: 13 }, (_, i) => reading(i * 1000)));
    await drain.run();
    expect(times(await outbox.pending())).toEqual([0, 5000, 10000]);
    expect(BLE_SAMPLE_SPACING_MS).toBe(5000);
  });

  it('a última aceita vale entre rodadas e entre processos (arquivo)', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage });
    first.push(reading(0), reading(4000));
    await first.drain.run();

    const second = setup({ stateStorage, outboxStorage });
    second.push(reading(4900), reading(5000), reading(9000), reading(10_000));
    await second.drain.run();
    expect(times(await second.outbox.pending())).toEqual([0, 5000, 10000]);
  });

  it.each([
    ['contato suportado e não detectado', b64(CONTACT_SUPPORTED, 80)],
    ['bpm 0', hr(0)],
    ['abaixo de 20', hr(19)],
    ['acima de 300', b64(0x01, 0x2d, 0x01)],
    ['base64 inválido', '***'],
    ['pacote curto', b64(0x01, 0x50)],
  ])('descarta %s sem ocupar a vez da próxima', async (_nome, bytes) => {
    const { drain, push, outbox } = setup();
    push(reading(0, bytes), reading(1000, hr(70)));
    await drain.run();
    expect(times(await outbox.pending())).toEqual([1000]);
  });

  it('mantém contato detectado e sensor sem suporte a contato', async () => {
    const { drain, push, outbox } = setup();
    push(reading(0, b64(CONTACT_SUPPORTED | CONTACT_DETECTED, 80)), reading(5000, b64(CONTACT_DETECTED, 81)));
    await drain.run();
    expect((await outbox.pending()).map((e) => e.measurements.heartRate?.value)).toEqual([80, 81]);
  });

  it('aceita os limites 20 e 300', async () => {
    const { drain, push, outbox } = setup();
    push(reading(0, hr(20)), reading(5000, b64(0x01, 0x2c, 0x01)));
    await drain.run();
    expect((await outbox.pending()).map((e) => e.measurements.heartRate?.value)).toEqual([20, 300]);
  });

  it('descarta leitura de antes da escolha da pulseira', async () => {
    const { drain, push, outbox } = setup({ choice: { ...POLAR, chosenAt: T0 + 2000 } });
    push(reading(0), reading(3000));
    await drain.run();
    expect(times(await outbox.pending())).toEqual([3000]);
  });

  it('escolha sem hora guardada vale desde sempre', async () => {
    const { drain, push, outbox } = setup({ choice: { deviceId: POLAR.deviceId, name: POLAR.name } });
    push(reading(0));
    await drain.run();
    expect(times(await outbox.pending())).toEqual([0]);
  });

  it('mesma escolha, mesma sessão, relida do arquivo, com a sequência seguindo', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage });
    first.push(reading(0));
    await first.drain.run();
    const second = setup({ stateStorage, outboxStorage });
    second.push(reading(5000));
    await second.drain.run();
    const events = await second.outbox.pending();
    expect(new Set(events.map((e) => e.monitoringSessionId)).size).toBe(1);
    expect(events.map((e) => e.sequence)).toEqual([0, 1]);
  });

  it('trocar de pulseira abre sessão nova e esquece o contador da anterior', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage });
    first.push(reading(0));
    await first.drain.run();
    const [old] = await first.outbox.pending();

    const second = setup({ stateStorage, outboxStorage, choice: OUTRA });
    const forget = jest.spyOn(second.outbox, 'forgetSession');
    second.push(reading(2000));
    await second.drain.run();
    const events = await second.outbox.pending();
    expect(events[1].monitoringSessionId).not.toBe(old.monitoringSessionId);
    expect(events[1].sequence).toBe(0);
    expect(forget).toHaveBeenCalledWith(old.monitoringSessionId);
    expect(second.ble.stop).not.toHaveBeenCalled();
  });

  it('na troca, o que chegou antes da nova escolha fecha a sessão anterior', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage });
    first.push(reading(-10_000));
    await first.drain.run();

    const second = setup({ stateStorage, outboxStorage, choice: OUTRA });
    second.push(reading(0), reading(2000));
    await second.drain.run();
    const events = await second.outbox.pending();
    expect(times(events)).toEqual([-10_000, 0, 2000]);
    expect(events[1].monitoringSessionId).toBe(events[0].monitoringSessionId);
    expect(events[2].monitoringSessionId).not.toBe(events[0].monitoringSessionId);
  });

  it('escolher de novo a mesma pulseira, depois de encerrar, abre sessão nova', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage });
    first.push(reading(0));
    await first.drain.run();

    const again = setup({ stateStorage, outboxStorage, choice: { ...POLAR, chosenAt: T0 + 1000 } });
    again.push(reading(2000));
    await again.drain.run();
    const events = await again.outbox.pending();
    expect(events[1].monitoringSessionId).not.toBe(events[0].monitoringSessionId);
  });

  it('a nova escolha não herda a vez da última aceita da anterior', async () => {
    const stateStorage = memoryStorage();
    const first = setup({ stateStorage });
    first.push(reading(0));
    await first.drain.run();
    const second = setup({ stateStorage, choice: { ...POLAR, chosenAt: T0 + 500 } });
    second.push(reading(1000));
    await second.drain.run();
    expect(times(await second.outbox.pending())).toEqual([1000]);
  });

  it('pulseira encerrada: drena o resto na sessão, envia e para o serviço; a próxima escolha abre outra', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const open = setup({ stateStorage, outboxStorage });
    open.push(reading(0));
    await open.drain.run();
    expect(open.ble.stop).not.toHaveBeenCalled();

    const ended = setup({ stateStorage, outboxStorage, choice: null });
    ended.push(reading(5000));
    await ended.drain.run();
    const events = await ended.outbox.pending();
    expect(times(events)).toEqual([0, 5000]);
    expect(events[1].monitoringSessionId).toBe(events[0].monitoringSessionId);
    expect(ended.uploader.uploadPending).toHaveBeenCalled();
    expect(ended.ble.stop).toHaveBeenCalledTimes(1);

    const next = setup({ stateStorage, outboxStorage, choice: { ...POLAR, chosenAt: T0 + 6000 } });
    next.push(reading(7000));
    await next.drain.run();
    const after = await next.outbox.pending();
    expect(after[2].monitoringSessionId).not.toBe(events[0].monitoringSessionId);
  });

  it('sem pulseira escolhida e sem sessão guardada descarta as leituras e para o serviço', async () => {
    const { drain, push, outbox, ble } = setup({ choice: null });
    push(reading(0));
    await drain.run();
    expect(await outbox.pending()).toEqual([]);
    expect(ble.stop).toHaveBeenCalledTimes(1);
  });

  it('não para por tempo: 13 h depois da escolha segue aceitando, sem parar o serviço', async () => {
    const thirteenHours = 13 * 60 * 60 * 1000;
    const { drain, push, outbox, ble } = setup();
    push(reading(0), reading(thirteenHours));
    await drain.run();
    expect(times(await outbox.pending())).toEqual([0, thirteenHours]);
    expect(ble.stop).not.toHaveBeenCalled();
  });

  it('escolha que não pôde ser lida não para o serviço nem troca a sessão', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage });
    first.push(reading(0));
    await first.drain.run();

    const broken = setup({ stateStorage, outboxStorage, choice: new Error('disco') });
    broken.push(reading(5000));
    await broken.drain.run();
    const events = await broken.outbox.pending();
    expect(times(events)).toEqual([0, 5000]);
    expect(events[1].monitoringSessionId).toBe(events[0].monitoringSessionId);
    expect(broken.ble.stop).not.toHaveBeenCalled();
  });

  it('o teto das leituras à espera é só de memória: as mais antigas saem primeiro', async () => {
    const stateStorage = memoryStorage(
      JSON.stringify({
        session: {
          key: `${POLAR.deviceId}|${POLAR.chosenAt}`,
          sessionId: 'sessao-1',
          lastAcceptedAt: null,
        },
        pending: Array.from({ length: BLE_PENDING_MAX }, (_, i) => ({
          sessionId: 'sessao-1',
          receivedAt: T0 + i * BLE_SAMPLE_SPACING_MS,
          bpm: 80,
        })),
      }),
    );
    const { drain, push, outbox } = setup({ stateStorage });
    const appendMany = jest.spyOn(outbox, 'appendMany').mockRejectedValueOnce(new Error('disco'));
    push(reading(BLE_PENDING_MAX * BLE_SAMPLE_SPACING_MS));
    await drain.run();
    expect(appendMany).toHaveBeenCalledTimes(1);
    const kept = JSON.parse(stateStorage.current() ?? '{}').pending as { receivedAt: number }[];
    expect(kept).toHaveLength(BLE_PENDING_MAX);
    expect(kept[0].receivedAt).toBe(T0 + BLE_SAMPLE_SPACING_MS);
    expect(BLE_PENDING_MAX).toBe(8640);
  });

  it('fila que lança não perde as leituras tiradas da caixa: entram na rodada seguinte', async () => {
    const { drain, push, outbox } = setup();
    const appendMany = jest.spyOn(outbox, 'appendMany').mockRejectedValueOnce(new Error('disco'));
    push(reading(0, hr(70)), reading(5000, hr(71)));
    await expect(drain.run()).resolves.toBeUndefined();
    expect(await outbox.pending()).toEqual([]);

    push(reading(10_000, hr(72)));
    await drain.run();
    expect(appendMany).toHaveBeenCalledTimes(2);
    const events = await outbox.pending();
    expect(times(events)).toEqual([0, 5000, 10000]);
    expect(events.map((e) => e.measurements.heartRate?.value)).toEqual([70, 71, 72]);
  });

  it('contador da fila que lança também não perde as leituras', async () => {
    const { drain, push, outbox } = setup();
    jest.spyOn(outbox, 'nextSequence').mockRejectedValueOnce(new Error('disco'));
    push(reading(0));
    await drain.run();
    await drain.run();
    expect(times(await outbox.pending())).toEqual([0]);
  });

  it('as leituras à espera da fila sobrevivem ao processo (arquivo de estado)', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage });
    jest.spyOn(first.outbox, 'appendMany').mockRejectedValueOnce(new Error('disco'));
    first.push(reading(0));
    await first.drain.run();

    const second = setup({ stateStorage, outboxStorage });
    await second.drain.run();
    expect(times(await second.outbox.pending())).toEqual([0]);
  });

  it('encerrada com leituras à espera da fila: ficam guardadas até entrarem', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const open = setup({ stateStorage, outboxStorage });
    open.push(reading(0));
    await open.drain.run();

    const ended = setup({ stateStorage, outboxStorage, choice: null });
    jest.spyOn(ended.outbox, 'appendMany').mockRejectedValueOnce(new Error('disco'));
    ended.push(reading(5000));
    await ended.drain.run();

    const later = setup({ stateStorage, outboxStorage, choice: null });
    const forget = jest.spyOn(later.outbox, 'forgetSession');
    await later.drain.run();
    const events = await later.outbox.pending();
    expect(times(events)).toEqual([0, 5000]);
    expect(events[1].monitoringSessionId).toBe(events[0].monitoringSessionId);
    // Entrou o resto da sessão encerrada: o contador dela pode ir embora.
    expect(forget).toHaveBeenCalledWith(events[0].monitoringSessionId);
  });

  it('sem credencial (pareamento revogado): não toca a rede, para o serviço e encerra a sessão', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const paired = setup({ stateStorage, outboxStorage });
    paired.push(reading(0));
    await paired.drain.run();

    const revoked = setup({ stateStorage, outboxStorage, credential: false });
    revoked.push(reading(5000));
    await revoked.drain.run();
    // O que chegou até aqui é da sessão guardada.
    const events = await revoked.outbox.pending();
    expect(times(events)).toEqual([0, 5000]);
    expect(events[1].monitoringSessionId).toBe(events[0].monitoringSessionId);
    expect(revoked.uploader.uploadPending).not.toHaveBeenCalled();
    expect(revoked.ble.stop).toHaveBeenCalledTimes(1);

    // Pareado de novo, com a mesma pulseira escolhida: o aparelho é outro, e a
    // sessão também.
    const repaired = setup({ stateStorage, outboxStorage });
    repaired.push(reading(10_000));
    await repaired.drain.run();
    const after = await repaired.outbox.pending();
    expect(after[2].monitoringSessionId).not.toBe(events[0].monitoringSessionId);
  });

  it('sem credencial e sem sessão guardada descarta as leituras', async () => {
    const { drain, push, outbox, ble } = setup({ credential: false });
    push(reading(0));
    await drain.run();
    expect(await outbox.pending()).toEqual([]);
    expect(ble.stop).toHaveBeenCalledTimes(1);
  });

  it('envio adiado ou que lança não perde a leitura nem rejeita', async () => {
    const deferred = setup({ outcomes: [{ outcome: 'deferred' }] });
    deferred.push(reading(0));
    await deferred.drain.run();
    expect(await deferred.outbox.pending()).toHaveLength(1);

    const throwing = setup();
    throwing.uploader.uploadPending.mockRejectedValueOnce(new Error('rede'));
    throwing.push(reading(0));
    await expect(throwing.drain.run()).resolves.toBeUndefined();
    expect(await throwing.outbox.pending()).toHaveLength(1);
  });

  it('drena de novo enquanto o envio tira da fila e sobra', async () => {
    const { drain, push, uploader } = setup({
      outcomes: [
        { outcome: 'sent', accepted: 200, duplicates: 0, conflicts: 0, remaining: 5 },
        { outcome: 'sent', accepted: 5, duplicates: 0, conflicts: 0, remaining: 0 },
      ],
    });
    push(reading(0));
    await drain.run();
    expect(uploader.uploadPending).toHaveBeenCalledTimes(2);
  });

  it('aparelho despareado (401) para o serviço, mantém a fila e encerra a sessão', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage, outcomes: [{ outcome: 'unpaired' }] });
    first.push(reading(0));
    await first.drain.run();
    expect(first.ble.stop).toHaveBeenCalledTimes(1);
    const [old] = await first.outbox.pending();
    expect(old).toBeDefined();

    const repaired = setup({ stateStorage, outboxStorage });
    repaired.push(reading(5000));
    await repaired.drain.run();
    const events = await repaired.outbox.pending();
    expect(events[1].monitoringSessionId).not.toBe(old.monitoringSessionId);
  });

  it('sem leitura nova ainda tenta mandar o que sobrou na fila', async () => {
    const { drain, uploader, outbox } = setup();
    await drain.run();
    expect(await outbox.pending()).toEqual([]);
    expect(uploader.uploadPending).toHaveBeenCalledTimes(1);
  });

  it('nunca rejeita, nem com a caixa ou o arquivo de estado quebrados', async () => {
    const { drain, ble, deps } = setup();
    ble.rotateReadings.mockImplementationOnce(() => {
      throw new Error('ponte');
    });
    await expect(drain.run()).resolves.toBeUndefined();
    (deps.state.read as jest.Mock).mockRejectedValueOnce(new Error('disco'));
    await expect(drain.run()).resolves.toBeUndefined();
  });

  it('arquivo de estado ilegível recomeça a sessão', async () => {
    const { drain, push, outbox } = setup({ stateStorage: memoryStorage('{lixo') });
    push(reading(0));
    await drain.run();
    expect(await outbox.pending()).toHaveLength(1);
  });

  it('duas chamadas juntas viram uma rodada só', async () => {
    const { drain, push, ble } = setup();
    push(reading(0));
    await Promise.all([drain.run(), drain.run()]);
    expect(ble.rotateReadings).toHaveBeenCalledTimes(1);
  });
});

// Cada pareamento cria outro aparelho no backend, que recusa as sessões do
// anterior (session_unavailable) evento a evento, e a recusa tira o evento da
// fila. O pareamento grava a credencial nova por cima da antiga, sem a rodada
// ver o aparelho sem credencial: sem o reset, a sessão da pulseira seguia a
// mesma e todo batimento era descartado até encerrar.
describe('bluetoothInboxDrain, pareamento novo', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  const sessionsOf = (events: readonly { monitoringSessionId: string }[]) => [
    ...new Set(events.map((e) => e.monitoringSessionId)),
  ];
  const savedSession = (storage: ReturnType<typeof memoryStorage>) =>
    (JSON.parse(storage.current() || 'null') as { session: { sessionId: string } | null } | null)?.session
      ?.sessionId ?? null;

  it('re-pareado com a credencial sempre presente, a rodada sozinha segue na sessão velha', async () => {
    const { drain, push, outbox } = setup();
    push(reading(0));
    await drain.run();
    push(reading(5000));
    await drain.run();
    // A rodada sozinha não percebe o aparelho novo: quem percebe é o
    // pareamento, e é ele que chama o reset.
    expect(sessionsOf(await outbox.pending())).toHaveLength(1);
  });

  it('pareamento novo: fila, leituras à espera e as seguintes vão para uma sessão nova', async () => {
    const { drain, push, outbox, outboxStorage, stateStorage } = setup({ outcomes: [{ outcome: 'deferred' }] });
    push(reading(0), reading(5000));
    await drain.run();
    const [old] = sessionsOf(await outbox.pending());
    // A fila falha uma vez: a leitura dos 10 s fica à espera, no arquivo.
    jest.spyOn(outbox, 'appendMany').mockRejectedValueOnce(new Error('disco'));
    push(reading(10_000));
    await drain.run();

    await drain.resetForNewPairing();
    push(reading(15_000));
    await drain.run();

    const events = await outbox.pending();
    expect(times(events)).toEqual([0, 5000, 10_000, 15_000]);
    expect(sessionsOf(events)).toEqual([savedSession(stateStorage)]);
    expect(events[0].monitoringSessionId).not.toBe(old);
    expect(events.map((e) => e.sequence)).toEqual([0, 1, 2, 3]);
    // O contador da sessão velha sai: nada mais vai para ela.
    const queue = JSON.parse(outboxStorage.current()!) as { sequences: Record<string, number> };
    expect(queue.sequences).not.toHaveProperty(old);
  });

  it('a sessão nova do reset vale para o próximo processo (arquivo de estado)', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage, outcomes: [{ outcome: 'deferred' }] });
    first.push(reading(0));
    await first.drain.run();
    const [old] = sessionsOf(await first.outbox.pending());
    await first.drain.resetForNewPairing();

    const second = setup({ stateStorage, outboxStorage });
    second.push(reading(5000));
    await second.drain.run();
    const events = await second.outbox.pending();
    expect(times(events)).toEqual([0, 5000]);
    expect(sessionsOf(events)).toHaveLength(1);
    expect(events[0].monitoringSessionId).not.toBe(old);
  });

  // A pendência do 401 e da credencial ausente: a sessão fechou, mas o que ela
  // juntou ainda está na fila, e subiria com a credencial nova só para voltar
  // recusado.
  it('eventos de sessão fechada sem credencial saem da sessão velha, que não vira a corrente', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const paired = setup({ stateStorage, outboxStorage, outcomes: [{ outcome: 'deferred' }] });
    paired.push(reading(0));
    await paired.drain.run();
    const revoked = setup({ stateStorage, outboxStorage, credential: false });
    revoked.push(reading(5000));
    await revoked.drain.run();
    const [old] = sessionsOf(await revoked.outbox.pending());
    expect(savedSession(stateStorage)).toBeNull();

    const repaired = setup({ stateStorage, outboxStorage });
    const forget = jest.spyOn(repaired.outbox, 'forgetSession');
    await repaired.drain.resetForNewPairing();
    const moved = await repaired.outbox.pending();
    expect(times(moved)).toEqual([0, 5000]);
    expect(sessionsOf(moved)).toHaveLength(1);
    expect(moved[0].monitoringSessionId).not.toBe(old);
    expect(moved.map((e) => e.sequence)).toEqual([0, 1]);
    // Continua fechada: o contador sai com o último evento, e a próxima
    // rodada abre a sessão da escolha, outra.
    expect(forget).toHaveBeenCalledWith(moved[0].monitoringSessionId);
    expect(savedSession(stateStorage)).toBeNull();

    repaired.push(reading(10_000));
    await repaired.drain.run();
    const after = await repaired.outbox.pending();
    expect(times(after)).toEqual([0, 5000, 10_000]);
    expect(after[2].monitoringSessionId).not.toBe(moved[0].monitoringSessionId);
    expect(after[2].monitoringSessionId).not.toBe(old);
  });

  it('eventos de sessão fechada pelo 401 também mudam de sessão', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage, outcomes: [{ outcome: 'unpaired' }] });
    first.push(reading(0));
    await first.drain.run();
    const [old] = sessionsOf(await first.outbox.pending());

    await first.drain.resetForNewPairing();
    const moved = await first.outbox.pending();
    expect(times(moved)).toEqual([0]);
    expect(moved[0].monitoringSessionId).not.toBe(old);
  });

  it('não mexe nos eventos de outra origem (Health Connect) na fila', async () => {
    const { drain, outbox } = setup();
    const hc = {
      eventId: '00000000-0000-4000-8000-ffffffffffff',
      monitoringSessionId: '99999999-9999-4999-8999-999999999999',
      sequence: 0,
      eventTime: new Date(T0).toISOString(),
      origin: 'REAL' as const,
      measurements: { heartRate: { value: 70, unit: 'bpm' as const, source: 'HEALTH_CONNECT' as const } },
    };
    await outbox.append(hc);
    await drain.resetForNewPairing();
    expect(await outbox.pending()).toEqual([hc]);
  });

  it('sem nada da pulseira, o reset não grava arquivo nenhum', async () => {
    const { drain, stateStorage, outboxStorage } = setup();
    await drain.resetForNewPairing();
    expect(stateStorage.storage.write).not.toHaveBeenCalled();
    expect(outboxStorage.storage.write).not.toHaveBeenCalled();
  });

  it('nunca rejeita, e com a fila ilegível ainda troca a sessão das leituras à espera', async () => {
    const { drain, push, outbox, stateStorage } = setup();
    jest.spyOn(outbox, 'appendMany').mockRejectedValueOnce(new Error('disco'));
    push(reading(0));
    await drain.run();
    const old = savedSession(stateStorage);
    jest.spyOn(outbox, 'pending').mockRejectedValueOnce(new Error('disco'));
    await expect(drain.resetForNewPairing()).resolves.toBeUndefined();
    const events = await outbox.pending();
    expect(times(events)).toEqual([0]);
    expect(events[0].monitoringSessionId).not.toBe(old);
    expect(events[0].monitoringSessionId).toBe(savedSession(stateStorage));
  });

  it('pedido no meio de uma rodada, espera por ela e leva o que ela enfileirou', async () => {
    const { drain, push, outbox, stateStorage } = setup({ outcomes: [{ outcome: 'deferred' }] });
    const forget = jest.spyOn(outbox, 'forgetSession');
    push(reading(0));
    await Promise.all([drain.run(), drain.resetForNewPairing()]);
    const current = savedSession(stateStorage);
    const events = await outbox.pending();
    expect(times(events)).toEqual([0]);
    expect(events[0].monitoringSessionId).toBe(current);
    // A rodada abriu uma sessão e enfileirou nela; o reset veio depois e a
    // trocou. Na ordem inversa não haveria sessão velha a esquecer.
    expect(forget).toHaveBeenCalledWith(expect.not.stringMatching(current!));
    expect(Object.keys((await outbox.load()).sequences)).toEqual([current]);
  });
});
