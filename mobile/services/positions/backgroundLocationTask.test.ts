import {
  createLocationHandler,
  DRAIN_MIN_INTERVAL_MS,
  type TaskLocation,
} from './backgroundLocationTask';
import { createPositionOutbox } from './positionOutbox';
import { createTrackingWindowStore, TRACKING_MAX_MS } from './trackingWindow';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

function memoryStorage(): OutboxStorage {
  let text: string | null = null;
  return {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
  };
}

const T0 = Date.parse('2026-10-04T12:00:00.000Z');

// A forma que o expo-location entrega à tarefa: timestamp em ms, coords em graus.
const leitura = (segundos: number, latitude = -23.55): TaskLocation => ({
  timestamp: T0 + segundos * 1000,
  coords: { latitude, longitude: -46.63 },
});

async function setup(opts: { janela?: 'aberta' | 'vencida' | 'nenhuma' } = {}) {
  const outbox = createPositionOutbox(memoryStorage());
  const window = createTrackingWindowStore(memoryStorage());
  if (opts.janela !== 'nenhuma') {
    const inicio = opts.janela === 'vencida' ? T0 - TRACKING_MAX_MS : T0 - 60_000;
    await window.open('u1', new Date(inicio));
  }
  let agora = T0;
  const drain = jest.fn(async (_owner: string) => ({ sent: 0, outcome: 'sent' as const }));
  const stopUpdates = jest.fn(async () => undefined);
  const { handle, reset } = createLocationHandler({
    window,
    outbox,
    drainer: { drain },
    stopUpdates,
    now: () => new Date(agora),
  });
  return {
    outbox,
    window,
    drain,
    stopUpdates,
    handle,
    reset,
    avancar: (ms: number) => {
      agora += ms;
    },
  };
}

describe('createLocationHandler', () => {
  it('com a janela aberta, guarda a leitura com a hora da medição e drena', async () => {
    const { outbox, drain, handle, stopUpdates } = await setup();
    await handle([leitura(0)]);
    expect(await outbox.pending('u1')).toEqual([
      { lat: -23.55, lng: -46.63, recordedAt: new Date(T0).toISOString() },
    ]);
    expect(drain).toHaveBeenCalledWith('u1');
    expect(stopUpdates).not.toHaveBeenCalled();
  });

  it('sem janela, desliga o rastreio e não guarda nada', async () => {
    const { outbox, drain, handle, stopUpdates } = await setup({ janela: 'nenhuma' });
    await handle([leitura(0)]);
    expect(stopUpdates).toHaveBeenCalledTimes(1);
    expect(drain).not.toHaveBeenCalled();
    expect(await outbox.pending('u1')).toEqual([]);
  });

  it('passadas as 12 h, desliga o rastreio e não guarda nada', async () => {
    const { outbox, handle, stopUpdates } = await setup({ janela: 'vencida' });
    await handle([leitura(0)]);
    expect(stopUpdates).toHaveBeenCalledTimes(1);
    expect(await outbox.pending('u1')).toEqual([]);
  });

  it('drena no máximo a cada 10 s, mas guarda toda leitura que vira amostra', async () => {
    const { outbox, drain, handle, avancar } = await setup();
    await handle([leitura(0)]);
    avancar(DRAIN_MIN_INTERVAL_MS - 1);
    await handle([leitura(60)]);
    expect(drain).toHaveBeenCalledTimes(1);
    avancar(1);
    await handle([leitura(120)]);
    expect(drain).toHaveBeenCalledTimes(2);
    expect(await outbox.pending('u1')).toHaveLength(3);
  });

  it('leitura parada antes de 60 s não toca o disco nem a rede', async () => {
    const { outbox, drain, handle, avancar } = await setup();
    await handle([leitura(0)]);
    avancar(DRAIN_MIN_INTERVAL_MS);
    await handle([leitura(1), leitura(2)]);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(await outbox.pending('u1')).toHaveLength(1);
  });

  it('lote vazio ou leitura sem coordenada é ignorado sem quebrar', async () => {
    const { outbox, handle } = await setup();
    await handle([]);
    await handle([{ timestamp: T0 } as unknown as TaskLocation]);
    expect(await outbox.pending('u1')).toEqual([]);
  });

  // Ao ligar as leituras o sistema pode entregar primeiro uma posição guardada,
  // medida antes de a jornada começar. Ela não é da jornada e não entra.
  it('leitura medida antes do início da janela é descartada', async () => {
    const { outbox, handle } = await setup();
    // A janela do setup abre 60 s antes de T0.
    await handle([leitura(-3600), leitura(-61)]);
    expect(await outbox.pending('u1')).toEqual([]);
    await handle([leitura(0)]);
    expect(await outbox.pending('u1')).toHaveLength(1);
  });

  it('a posição antiga não segura a primeira leitura boa do mesmo lote', async () => {
    const { outbox, handle } = await setup();
    await handle([leitura(-3600), leitura(1)]);
    expect(await outbox.pending('u1')).toEqual([
      { lat: -23.55, lng: -46.63, recordedAt: new Date(T0 + 1000).toISOString() },
    ]);
  });

  // O filtro em memória é zerado quando o rastreio desliga (registerLocationTask):
  // quem começa a jornada em seguida não perde o primeiro ponto.
  it('depois de zerado, a próxima pessoa não herda o espaçamento da anterior', async () => {
    const { outbox, window, handle, reset } = await setup();
    await handle([leitura(0)]);
    reset();
    await window.close();
    await window.open('u2', new Date(T0));
    await handle([leitura(5)]);
    expect(await outbox.pending('u2')).toHaveLength(1);
  });

  it('falha no dreno não derruba a tarefa e a leitura fica guardada', async () => {
    const { outbox, drain, handle } = await setup();
    drain.mockRejectedValueOnce(new Error('rede'));
    await expect(handle([leitura(0)])).resolves.toBeUndefined();
    expect(await outbox.pending('u1')).toHaveLength(1);
  });
});
