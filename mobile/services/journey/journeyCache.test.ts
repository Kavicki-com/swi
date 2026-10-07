import { createJourneyCache, JOURNEY_CACHE_FILE_NAME } from './journeyCache';
import type { JourneySnapshot } from './journeyTransitions';
import type { Task } from './types';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

function memoryStorage(initial: string | null = null) {
  let text = initial;
  const storage: OutboxStorage & { text: () => string | null } = {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
    text: () => text,
  };
  return storage;
}

const tarefa: Task = {
  id: 't1',
  title: 'Inspeção da correia',
  description: 'Conferir a tensão',
  objective: 'Manutenção preventiva',
  estimatedMinutes: 30,
  status: 'in_progress',
  startedAt: '2026-10-07T08:00:00.000Z',
  accumulatedSeconds: 120,
  progressPct: 10,
  images: ['https://media.exemplo/ordem.jpg?X-Amz-Signature=abc'],
  responsibleCount: 2,
  responsibleNames: ['Ana', 'Bruno'],
  responsibleAvatars: ['https://media.exemplo/ana.jpg?X-Amz-Signature=def'],
};

const snapshot: JourneySnapshot = {
  journey: {
    state: 'ongoing',
    activeTaskId: 't1',
    startedAt: '2026-10-07T08:00:00.000Z',
    accumulatedSeconds: 0,
  },
  tasks: [tarefa],
};

describe('journeyCache', () => {
  it('lê de volta a jornada de quem gravou, sem fotos nem avatares', async () => {
    const cache = createJourneyCache(memoryStorage());

    await cache.write('u1', snapshot);

    expect(await cache.read('u1')).toEqual({
      journey: snapshot.journey,
      tasks: [{ ...tarefa, images: [], responsibleAvatars: [] }],
    });
  });

  it('não grava endereço assinado no arquivo', async () => {
    const storage = memoryStorage();

    await createJourneyCache(storage).write('u1', snapshot);

    expect(storage.text()).not.toContain('https://');
    expect(storage.text()).not.toContain('Signature');
  });

  // Campo novo que o servidor passe a mandar (outro endereço assinado, um dado
  // pessoal) não vai ao disco sem alguém decidir.
  it('grava só os campos conhecidos, da jornada e das tarefas', async () => {
    const storage = memoryStorage();
    const comMais = {
      journey: { ...snapshot.journey, extra: 'https://jornada.exemplo' },
      tasks: [{ ...tarefa, contrato: 'https://tarefa.exemplo' }],
    } as unknown as JourneySnapshot;

    await createJourneyCache(storage).write('u1', comMais);

    expect(storage.text()).not.toContain('extra');
    expect(storage.text()).not.toContain('contrato');
    expect(await createJourneyCache(storage).read('u1')).toEqual({
      journey: snapshot.journey,
      tasks: [{ ...tarefa, images: [], responsibleAvatars: [] }],
    });
  });

  it('a cópia de outra pessoa não vale', async () => {
    const cache = createJourneyCache(memoryStorage());
    await cache.write('u1', snapshot);

    expect(await cache.read('u2')).toBeNull();
  });

  it.each([
    ['sem arquivo', null],
    ['vazio', ''],
    ['ilegível', '{x'],
    ['lista', '[]'],
    ['versão desconhecida', JSON.stringify({ v: 2, owner: 'u1', journey: snapshot.journey, tasks: [] })],
    ['estado inválido', JSON.stringify({ v: 1, owner: 'u1', journey: { ...snapshot.journey, state: 'x' }, tasks: [] })],
    [
      'tarefa sem título',
      JSON.stringify({ v: 1, owner: 'u1', journey: snapshot.journey, tasks: [{ ...tarefa, title: undefined }] }),
    ],
    [
      'tarefa com status inválido',
      JSON.stringify({ v: 1, owner: 'u1', journey: snapshot.journey, tasks: [{ ...tarefa, status: 'x' }] }),
    ],
  ])('conteúdo que não é cópia não vale (%s)', async (_caso, texto) => {
    expect(await createJourneyCache(memoryStorage(texto)).read('u1')).toBeNull();
  });

  it('falha de leitura do arquivo não vale como cópia', async () => {
    const storage: OutboxStorage = {
      read: async () => {
        throw new Error('disco');
      },
      write: async () => undefined,
    };
    expect(await createJourneyCache(storage).read('u1')).toBeNull();
  });

  it('apagada, não há mais cópia', async () => {
    const storage = memoryStorage();
    const cache = createJourneyCache(storage);
    await cache.write('u1', snapshot);

    await cache.clear();

    expect(await cache.read('u1')).toBeNull();
    expect(storage.text()).toBe('');
  });

  it('o arquivo tem nome próprio, versionado', () => {
    expect(JOURNEY_CACHE_FILE_NAME).toBe('journey-cache.v1.json');
  });
});
