import {
  createEvacuationWindowStore,
  EVACUATION_TRACKING_MAX_MS,
  isEvacuationOpen,
} from './evacuationWindow';
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

describe('isEvacuationOpen', () => {
  it('sem evacuação, fechado', () => {
    expect(isEvacuationOpen(null, T0)).toBe(false);
  });

  it('aberta até o teto depois do início, fechada a partir daí', () => {
    const evacuacao = { userId: 'u1', evacuationId: 'e1', startedAt: T0.toISOString() };
    expect(isEvacuationOpen(evacuacao, depois(EVACUATION_TRACKING_MAX_MS - 1))).toBe(true);
    expect(isEvacuationOpen(evacuacao, depois(EVACUATION_TRACKING_MAX_MS))).toBe(false);
  });

  it('início ilegível conta como fechada', () => {
    expect(isEvacuationOpen({ userId: 'u1', evacuationId: 'e1', startedAt: 'x' }, T0)).toBe(false);
  });
});

describe('createEvacuationWindowStore', () => {
  it('sem arquivo ou com arquivo ilegível, não há evacuação', async () => {
    for (const text of [null, '', '{x', '[]', '{"userId":"u1","startedAt":"2026-10-04T08:00:00.000Z"}']) {
      const store = createEvacuationWindowStore(memoryStorage(text));
      expect(await store.read()).toBeNull();
    }
  });

  it('disco que falha na leitura é ausência de evacuação', async () => {
    const store = createEvacuationWindowStore({
      read: async () => {
        throw new Error('disco');
      },
      write: async () => undefined,
    });
    expect(await store.read()).toBeNull();
  });

  it('abrir grava pessoa, evacuação e início, e sobrevive a reinício', async () => {
    const storage = memoryStorage();
    await createEvacuationWindowStore(storage).open('u1', 'e1', T0);
    expect(await createEvacuationWindowStore(storage).read()).toEqual({
      userId: 'u1',
      evacuationId: 'e1',
      startedAt: T0.toISOString(),
    });
  });

  it('reabrir a mesma evacuação da mesma pessoa mantém o início', async () => {
    const store = createEvacuationWindowStore(memoryStorage());
    await store.open('u1', 'e1', T0);
    const reaberta = await store.open('u1', 'e1', depois(EVACUATION_TRACKING_MAX_MS + 1));
    expect(reaberta.startedAt).toBe(T0.toISOString());
  });

  it('outra evacuação ou outra pessoa recomeça', async () => {
    const store = createEvacuationWindowStore(memoryStorage());
    await store.open('u1', 'e1', T0);
    expect((await store.open('u1', 'e2', depois(1000))).startedAt).toBe(depois(1000).toISOString());
    expect(await store.open('u2', 'e2', depois(2000))).toEqual({
      userId: 'u2',
      evacuationId: 'e2',
      startedAt: depois(2000).toISOString(),
    });
  });

  it('fechar apaga', async () => {
    const store = createEvacuationWindowStore(memoryStorage());
    await store.open('u1', 'e1', T0);
    await store.close();
    expect(await store.read()).toBeNull();
  });
});
