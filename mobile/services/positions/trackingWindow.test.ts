import { createTrackingWindowStore, isWindowOpen, TRACKING_MAX_MS } from './trackingWindow';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

function memoryStorage(initial: string | null = null) {
  let text = initial;
  const storage: OutboxStorage = {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
  };
  return storage;
}

const T0 = new Date('2026-10-04T08:00:00.000Z');
const depois = (ms: number) => new Date(T0.getTime() + ms);

describe('isWindowOpen', () => {
  it('sem janela, fechado', () => {
    expect(isWindowOpen(null, T0)).toBe(false);
  });

  it('aberta até 12 h depois do início, fechada a partir daí', () => {
    const janela = { userId: 'u1', startedAt: T0.toISOString() };
    expect(isWindowOpen(janela, depois(TRACKING_MAX_MS - 1))).toBe(true);
    expect(isWindowOpen(janela, depois(TRACKING_MAX_MS))).toBe(false);
  });

  it('início ilegível conta como fechada', () => {
    expect(isWindowOpen({ userId: 'u1', startedAt: 'x' }, T0)).toBe(false);
  });
});

describe('createTrackingWindowStore', () => {
  it('sem arquivo ou com arquivo ilegível, não há janela', async () => {
    for (const text of [null, '', '{x', '[]', '{"userId":1}']) {
      const store = createTrackingWindowStore(memoryStorage(text));
      expect(await store.read()).toBeNull();
    }
  });

  it('disco que falha na leitura é ausência de janela', async () => {
    const store = createTrackingWindowStore({
      read: async () => {
        throw new Error('disco');
      },
      write: async () => undefined,
    });
    expect(await store.read()).toBeNull();
  });

  it('abrir grava o início e sobrevive a reinício', async () => {
    const storage = memoryStorage();
    await createTrackingWindowStore(storage).open('u1', T0);
    expect(await createTrackingWindowStore(storage).read()).toEqual({
      userId: 'u1',
      startedAt: T0.toISOString(),
    });
  });

  it('reabrir para a mesma pessoa mantém o início, mesmo depois das 12 h', async () => {
    const store = createTrackingWindowStore(memoryStorage());
    await store.open('u1', T0);
    // Pausa e retomada, ou o app reaberto: o relógio das 12 h não recomeça.
    const reaberta = await store.open('u1', depois(TRACKING_MAX_MS + 1));
    expect(reaberta.startedAt).toBe(T0.toISOString());
  });

  it('abrir para outra pessoa recomeça a janela', async () => {
    const store = createTrackingWindowStore(memoryStorage());
    await store.open('u1', T0);
    const nova = await store.open('u2', depois(1000));
    expect(nova).toEqual({ userId: 'u2', startedAt: depois(1000).toISOString() });
  });

  it('fechar apaga, e a próxima abertura recomeça', async () => {
    const store = createTrackingWindowStore(memoryStorage());
    await store.open('u1', T0);
    await store.close();
    expect(await store.read()).toBeNull();
    expect((await store.open('u1', depois(5000))).startedAt).toBe(depois(5000).toISOString());
  });
});
