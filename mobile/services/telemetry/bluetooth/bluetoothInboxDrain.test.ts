import type { RawHeartRateReading } from '../../../modules/swi-ble-heart-rate/src';
import type { TrackingWindow } from '../../positions/trackingWindow';
import { createTelemetryOutbox, type OutboxStorage } from '../telemetryOutbox';
import type { UploadOutcome } from '../telemetryUploader';
import {
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
const USER = 'user-1';

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
    window?: TrackingWindow | null;
    now?: number;
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
  const window =
    opts.window === undefined ? { userId: USER, startedAt: new Date(T0 - 60_000).toISOString() } : opts.window;
  const stateStorage = opts.stateStorage ?? memoryStorage();
  const outboxStorage = opts.outboxStorage ?? memoryStorage();
  const outbox = createTelemetryOutbox(outboxStorage.storage);
  const outcomes = [...(opts.outcomes ?? [])];
  const uploader = {
    uploadPending: jest.fn(async (): Promise<UploadOutcome> => outcomes.shift() ?? { outcome: 'idle' }),
  };
  const deps: BluetoothInboxDrainDeps = {
    ble,
    window: { read: jest.fn(async () => window) },
    state: stateStorage.storage,
    outbox,
    uploader,
    control: { hasDeviceCredential: () => opts.credential ?? true },
    now: () => new Date(opts.now ?? T0 + 60_000),
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

  it('descarta leitura de antes do começo da jornada', async () => {
    const { drain, push, outbox } = setup({
      window: { userId: USER, startedAt: new Date(T0 + 2000).toISOString() },
    });
    push(reading(0), reading(3000));
    await drain.run();
    expect(times(await outbox.pending())).toEqual([3000]);
  });

  it('mesma jornada, mesma sessão, relida do arquivo, com a sequência seguindo', async () => {
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

  it('jornada nova abre sessão nova e esquece o contador da anterior', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const first = setup({ stateStorage, outboxStorage });
    first.push(reading(0));
    await first.drain.run();
    const [old] = await first.outbox.pending();

    const second = setup({
      stateStorage,
      outboxStorage,
      window: { userId: USER, startedAt: new Date(T0 + 1000).toISOString() },
    });
    const forget = jest.spyOn(second.outbox, 'forgetSession');
    second.push(reading(2000));
    await second.drain.run();
    const events = await second.outbox.pending();
    expect(events[1].monitoringSessionId).not.toBe(old.monitoringSessionId);
    expect(events[1].sequence).toBe(0);
    expect(forget).toHaveBeenCalledWith(old.monitoringSessionId);
  });

  it('a nova jornada não herda a vez da última aceita da anterior', async () => {
    const stateStorage = memoryStorage();
    const first = setup({ stateStorage });
    first.push(reading(0));
    await first.drain.run();
    const second = setup({
      stateStorage,
      window: { userId: USER, startedAt: new Date(T0 + 500).toISOString() },
    });
    second.push(reading(1000));
    await second.drain.run();
    expect(times(await second.outbox.pending())).toEqual([1000]);
  });

  it('janela fechada: drena o resto na sessão da jornada, envia e para o serviço', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const open = setup({ stateStorage, outboxStorage });
    open.push(reading(0));
    await open.drain.run();
    expect(open.ble.stop).not.toHaveBeenCalled();

    const closed = setup({ stateStorage, outboxStorage, window: null });
    closed.push(reading(5000));
    await closed.drain.run();
    const events = await closed.outbox.pending();
    expect(times(events)).toEqual([0, 5000]);
    expect(events[1].monitoringSessionId).toBe(events[0].monitoringSessionId);
    expect(closed.uploader.uploadPending).toHaveBeenCalled();
    expect(closed.ble.stop).toHaveBeenCalledTimes(1);

    // A sessão encerrou com a jornada: a próxima abre outra.
    const next = setup({
      stateStorage,
      outboxStorage,
      window: { userId: USER, startedAt: new Date(T0 + 6000).toISOString() },
    });
    next.push(reading(7000));
    await next.drain.run();
    const after = await next.outbox.pending();
    expect(after[2].monitoringSessionId).not.toBe(events[0].monitoringSessionId);
  });

  it('janela fechada sem sessão guardada descarta as leituras e para o serviço', async () => {
    const { drain, push, outbox, ble } = setup({ window: null });
    push(reading(0));
    await drain.run();
    expect(await outbox.pending()).toEqual([]);
    expect(ble.stop).toHaveBeenCalledTimes(1);
  });

  it('janela vencida (12 h): só entra o que chegou antes do teto, e o serviço para', async () => {
    const startedAt = T0 - 12 * 60 * 60 * 1000 + 3000;
    const { drain, push, outbox, ble } = setup({
      window: { userId: USER, startedAt: new Date(startedAt).toISOString() },
      now: T0 + 60_000,
    });
    push(reading(0), reading(5000));
    await drain.run();
    expect(times(await outbox.pending())).toEqual([0]);
    expect(ble.stop).toHaveBeenCalledTimes(1);
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

  it('janela fechada com leituras à espera da fila: ficam guardadas até entrarem', async () => {
    const stateStorage = memoryStorage();
    const outboxStorage = memoryStorage();
    const open = setup({ stateStorage, outboxStorage });
    open.push(reading(0));
    await open.drain.run();

    const closed = setup({ stateStorage, outboxStorage, window: null });
    jest.spyOn(closed.outbox, 'appendMany').mockRejectedValueOnce(new Error('disco'));
    closed.push(reading(5000));
    await closed.drain.run();

    const later = setup({ stateStorage, outboxStorage, window: null });
    const forget = jest.spyOn(later.outbox, 'forgetSession');
    await later.drain.run();
    const events = await later.outbox.pending();
    expect(times(events)).toEqual([0, 5000]);
    expect(events[1].monitoringSessionId).toBe(events[0].monitoringSessionId);
    // Entrou o resto da jornada encerrada: o contador dela pode ir embora.
    expect(forget).toHaveBeenCalledWith(events[0].monitoringSessionId);
  });

  it('sem credencial enfileira e não toca a rede', async () => {
    const { drain, push, outbox, uploader } = setup({ credential: false });
    push(reading(0));
    await drain.run();
    expect(await outbox.pending()).toHaveLength(1);
    expect(uploader.uploadPending).not.toHaveBeenCalled();
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

  it('aparelho despareado (401) para o serviço e mantém a fila', async () => {
    const { drain, push, outbox, ble } = setup({ outcomes: [{ outcome: 'unpaired' }] });
    push(reading(0));
    await drain.run();
    expect(ble.stop).toHaveBeenCalledTimes(1);
    expect(await outbox.pending()).toHaveLength(1);
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
