import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { JourneyProvider, useJourney } from './JourneyProvider';
import { getJourneyBackend } from './getJourneyBackend';
import { getNotificationBackend } from '../notifications/getNotificationBackend';
import { createSendQueue, type SendQueue } from '../outbox/sendQueue';
import { createMemorySendStorage, createSendOutbox, type SendItem } from '../outbox/sendOutbox';
import type { SendFiles } from '../outbox/sendFiles';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';
import type { JourneySession, Task } from './types';

jest.mock('./getJourneyBackend', () => ({ getJourneyBackend: jest.fn() }));
jest.mock('../notifications/getNotificationBackend', () => ({
  getNotificationBackend: jest.fn(),
}));
// A fila é a de verdade, em memória; o teste controla só a resposta do envio.
let mockQueue: SendQueue;
jest.mock('../outbox/getSendQueue', () => ({ getSendQueue: () => mockQueue }));

const mockJourneyBackend = getJourneyBackend as jest.Mock;
const mockNotificationBackend = getNotificationBackend as jest.Mock;

const IDLE_SESSION: JourneySession = {
  state: 'idle',
  activeTaskId: null,
  startedAt: null,
  accumulatedSeconds: 0,
};
const ONGOING_SESSION: JourneySession = {
  state: 'ongoing',
  activeTaskId: 't1',
  startedAt: '2026-10-04T11:00:00.000Z',
  accumulatedSeconds: 0,
};

const task = (id: string, title: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    title,
    status: 'pending',
    startedAt: null,
    accumulatedSeconds: 0,
    progressPct: 0,
    estimatedMinutes: 60,
    images: [],
    ...over,
  }) as Task;

const semRede = () => new TypeError('Network request failed');

const filesNoLugar: SendFiles = {
  stage: async (uri) => uri,
  locate: (uri) => uri,
  discard: async () => undefined,
  sweep: async () => undefined,
};

function novaFila(send: jest.Mock, storage: OutboxStorage = createMemorySendStorage()) {
  let n = 0;
  return createSendQueue({
    outbox: createSendOutbox(storage),
    files: filesNoLugar,
    transport: { upload: async (_item: SendItem, uri: string) => `key:${uri}`, send },
    now: () => Date.now(),
    newId: () => `id-${(n += 1)}`,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let ctx: ReturnType<typeof useJourney>;
let renders: string[];

function Probe() {
  ctx = useJourney();
  const { tasks, loadStatus, state } = ctx;
  renders.push(`${loadStatus}:${state}`);
  return <Text>{`${loadStatus}|${state}|${tasks.map((t) => `${t.title}:${t.status}`).join(',')}`}</Text>;
}

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

describe('JourneyProvider', () => {
  let getJourney: jest.Mock;
  let listTasks: jest.Mock;
  let send: jest.Mock;
  let notify: ((n: any) => void) | null;

  beforeEach(async () => {
    renders = [];
    notify = null;
    getJourney = jest.fn().mockResolvedValue(IDLE_SESSION);
    listTasks = jest.fn().mockResolvedValue([]);
    mockJourneyBackend.mockReturnValue({ getJourney, listTasks, getTask: jest.fn() });
    mockNotificationBackend.mockReturnValue({
      subscribe: (cb: (n: any) => void) => {
        notify = cb;
        return () => {
          notify = null;
        };
      },
    });
    send = jest.fn(() => new Promise(() => {}));
    mockQueue = novaFila(send);
    await mockQueue.start('u1');
  });

  // Árvore que fica montada continua ouvindo a fila e o AppState, e o Probe
  // dela sobrescreveria `ctx` no teste seguinte.
  let mounted: ReturnType<typeof create>[] = [];
  afterEach(() => {
    act(() => mounted.forEach((tree) => tree.unmount()));
    mounted = [];
    mockQueue.stop();
  });

  const render = async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <JourneyProvider>
          <Probe />
        </JourneyProvider>,
      );
    });
    mounted.push(tree);
    return tree;
  };
  const text = (tree: ReturnType<typeof create>) => JSON.stringify(tree.toJSON());

  describe('tarefa nova sem deslogar', () => {
    it('recarrega quando chega notificação de jornada (o admin atribuiu)', async () => {
      const tree = await render();
      expect(text(tree)).toContain('empty|');

      // O backend passa a devolver a tarefa que o admin acabou de atribuir.
      listTasks.mockResolvedValue([task('t1', 'teste')]);
      await act(async () => {
        notify?.({ id: 'n1', domain: 'journey', targetId: 'order-1' });
      });

      expect(text(tree)).toContain('teste');
    });

    it('ignora notificação de outro domínio (não vale um round-trip)', async () => {
      await render();
      const callsAfterMount = listTasks.mock.calls.length;
      await act(async () => {
        notify?.({ id: 'n2', domain: 'chat', targetId: 'conv-1' });
      });
      expect(listTasks).toHaveBeenCalledTimes(callsAfterMount);
    });

    it('carga que falha depois de uma recarga mais nova dar certo não vira erro', async () => {
      let falhar!: (erro: Error) => void;
      listTasks.mockReturnValueOnce(new Promise<Task[]>((_resolve, reject) => (falhar = reject)));
      const tree = await render();
      listTasks.mockResolvedValue([task('t1', 'teste')]);
      await act(async () => {
        notify?.({ id: 'n8', domain: 'journey', targetId: 'order-1' });
      });

      await act(async () => falhar(new Error('rede caiu')));
      await flush();

      expect(text(tree)).toContain('ready|idle|teste');
    });

    it('recarga de fundo que falha mantém a lista na tela (não vira erro)', async () => {
      listTasks.mockResolvedValue([task('t1', 'teste')]);
      const tree = await render();
      expect(text(tree)).toContain('ready|idle|teste');

      listTasks.mockRejectedValue(new Error('rede caiu'));
      await act(async () => {
        notify?.({ id: 'n3', domain: 'journey', targetId: 'order-1' });
      });

      // Continua 'ready' com a tarefa, perder a lista por falha momentânea de
      // rede seria pior que mostrar dado de um segundo atrás.
      expect(text(tree)).toContain('ready|idle|teste');
    });
  });

  describe('ações pela fila', () => {
    beforeEach(() => {
      listTasks.mockResolvedValue([task('t1', 'Inspeção'), task('t2', 'Reparo')]);
    });

    it('a ação vale na tela na hora do toque, antes de o servidor responder', async () => {
      const tree = await render();

      let result: unknown;
      await act(async () => {
        result = await ctx.startTask({ id: 't1', title: 'Inspeção' });
      });

      expect(result).toBe('queued');
      expect(text(tree)).toContain('ready|ongoing|Inspeção:in_progress,Reparo:pending');
      expect(ctx.activeTaskId).toBe('t1');
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'journey.task.start', taskId: 't1', taskTitle: 'Inspeção' }),
      );
    });

    it('pausar, retomar e encerrar entram na fila e valem na tela', async () => {
      const tree = await render();

      await act(async () => {
        await ctx.startTask({ id: 't1', title: 'Inspeção' });
        await ctx.pauseJourney();
      });
      expect(text(tree)).toContain('ready|paused|Inspeção:paused');

      await act(async () => {
        await ctx.resumeJourney();
      });
      expect(text(tree)).toContain('ready|ongoing|Inspeção:in_progress');

      await act(async () => {
        await ctx.endJourney();
      });
      expect(text(tree)).toContain('ready|idle|Inspeção:paused');
      expect(mockQueue.getState().items.map((i) => i.kind)).toEqual([
        'journey.task.start',
        'journey.pause',
        'journey.resume',
        'journey.end',
      ]);
    });

    it('concluir e cancelar entram na fila e valem na tela', async () => {
      const tree = await render();

      await act(async () => {
        await ctx.startTask({ id: 't1', title: 'Inspeção' });
        await ctx.completeTask({ id: 't1', title: 'Inspeção' });
        await ctx.startTask({ id: 't2', title: 'Reparo' });
        await ctx.cancelTask({ id: 't2', title: 'Reparo' });
      });

      expect(text(tree)).toContain('ready|ongoing|Inspeção:done,Reparo:pending');
      expect(ctx.activeTaskId).toBeNull();
    });

    it('a foto da tarefa aparece na hora', async () => {
      await render();

      await act(async () => {
        await ctx.addTaskPhoto({ id: 't1', title: 'Inspeção' }, 'file:///f.jpg');
      });

      expect(ctx.tasks.find((t) => t.id === 't1')?.images).toEqual(['file:///f.jpg']);
    });

    // A cópia local sai do aparelho quando a foto sai da fila. A resposta é a
    // tarefa com as fotos do servidor, e só elas entram no lugar.
    it('foto confirmada troca a cópia local pela do servidor, antes da releitura', async () => {
      send.mockImplementationOnce(async () => ({ id: 't1', images: ['https://cdn/f.jpg'] }));
      await render();
      getJourney.mockReturnValueOnce(new Promise(() => {}));

      await act(async () => {
        await ctx.addTaskPhoto({ id: 't1', title: 'Inspeção' }, 'file:///f.jpg');
      });
      await flush();

      expect(mockQueue.getState().items).toEqual([]);
      expect(ctx.tasks.find((t) => t.id === 't1')?.images).toEqual(['https://cdn/f.jpg']);
    });

    it('nova leitura do servidor com ação ainda na fila não desfaz a ação', async () => {
      const tree = await render();
      await act(async () => {
        await ctx.startTask({ id: 't1', title: 'Inspeção' });
      });

      await act(async () => {
        notify?.({ id: 'n4', domain: 'journey', targetId: 'order-1' });
      });

      expect(text(tree)).toContain('ready|ongoing|Inspeção:in_progress');
    });
  });

  // O rastreio do 5.1 lê `state` assim que a jornada conta como carregada.
  describe('o GPS não liga nem desliga por engano', () => {
    it('a jornada só conta como carregada depois de abrir a fila guardada', async () => {
      getJourney.mockResolvedValue(ONGOING_SESSION);
      listTasks.mockResolvedValue([task('t1', 'Inspeção', { status: 'in_progress', startedAt: ONGOING_SESSION.startedAt })]);
      // Sem sinal, a pessoa encerrou a jornada e fechou o app.
      const disco = createMemorySendStorage();
      const antes = novaFila(jest.fn().mockRejectedValue(semRede()), disco);
      await antes.start('u1');
      await antes.enqueue({ kind: 'journey.end' });
      await antes.kick();
      antes.stop();
      mockQueue.stop();

      // O app abre de novo: a fila ainda não leu o arquivo quando o servidor responde.
      mockQueue = novaFila(jest.fn().mockRejectedValue(semRede()), disco);
      const tree = await render();
      expect(text(tree)).toContain('loading|');

      await act(async () => {
        await mockQueue.start('u1');
      });

      expect(text(tree)).toContain('ready|idle');
      expect(renders).not.toContain('ready:ongoing');
    });

    it('ação confirmada continua valendo até a releitura chegar', async () => {
      const resposta = deferred<unknown>();
      send.mockImplementationOnce(() => resposta.promise);
      listTasks.mockResolvedValue([task('t1', 'Inspeção'), task('t2', 'Reparo')]);
      await render();
      const releitura = deferred<JourneySession>();
      getJourney.mockReturnValueOnce(releitura.promise);

      await act(async () => {
        await ctx.startTask({ id: 't1', title: 'Inspeção' });
      });
      listTasks.mockResolvedValue([task('t1', 'Inspeção', { status: 'in_progress' }), task('t2', 'Reparo')]);
      renders = [];

      // O servidor confirma; a resposta não vira estado. A fila esvaziou: a
      // releitura sai, e até ela chegar a ação continua na tela.
      await act(async () => {
        resposta.resolve({ journey: { ...IDLE_SESSION, state: 'paused' }, task: { id: 't1' } });
      });
      await flush();
      expect(mockQueue.getState().items).toEqual([]);
      expect(getJourney).toHaveBeenCalledTimes(2);
      expect(ctx.state).toBe('ongoing');

      await act(async () => {
        releitura.resolve(ONGOING_SESSION);
      });

      expect(ctx.state).toBe('ongoing');
      expect(renders.every((r) => r === 'ready:ongoing')).toBe(true);
    });

    it('releitura antiga que chega depois de uma nova não apaga a ação confirmada', async () => {
      const resposta = deferred<unknown>();
      send.mockImplementationOnce(() => resposta.promise);
      listTasks.mockResolvedValue([task('t1', 'Inspeção'), task('t2', 'Reparo')]);
      await render();
      await act(async () => {
        await ctx.startTask({ id: 't1', title: 'Inspeção' });
      });

      // Uma recarga de fundo sai antes de o servidor aplicar a ação...
      const antiga = deferred<JourneySession>();
      getJourney.mockReturnValueOnce(antiga.promise);
      await act(async () => {
        notify?.({ id: 'n5', domain: 'journey', targetId: 'order-1' });
      });
      // ...a ação é confirmada, e a releitura de quando a fila esvazia já a traz.
      getJourney.mockResolvedValueOnce(ONGOING_SESSION);
      listTasks.mockResolvedValue([task('t1', 'Inspeção', { status: 'in_progress' }), task('t2', 'Reparo')]);
      await act(async () => {
        resposta.resolve({ journey: ONGOING_SESSION, task: { id: 't1' } });
      });
      await flush();
      expect(ctx.state).toBe('ongoing');

      // A recarga antiga chega por último, com o estado de antes da ação.
      await act(async () => {
        antiga.resolve(IDLE_SESSION);
      });

      expect(ctx.state).toBe('ongoing');
    });

    // Uma leitura que sai antes da confirmação e volta entre ela e a releitura
    // não pode pôr na tela o estado de antes: o GPS desligaria e religaria.
    it('leitura que saiu antes da confirmação não mostra o estado de antes', async () => {
      const resposta = deferred<unknown>();
      send.mockImplementationOnce(() => resposta.promise);
      listTasks.mockResolvedValue([task('t1', 'Inspeção'), task('t2', 'Reparo')]);
      await render();
      await act(async () => {
        await ctx.startTask({ id: 't1', title: 'Inspeção' });
      });
      const antiga = deferred<JourneySession>();
      getJourney.mockReturnValueOnce(antiga.promise);
      await act(async () => {
        notify?.({ id: 'n6', domain: 'journey', targetId: 'order-1' });
      });
      getJourney.mockReturnValueOnce(new Promise(() => {}));
      getJourney.mockResolvedValue(ONGOING_SESSION);
      renders = [];

      await act(async () => {
        resposta.resolve({ journey: ONGOING_SESSION, task: { id: 't1' } });
      });
      await flush();
      await act(async () => {
        antiga.resolve(IDLE_SESSION);
      });
      await flush();

      expect(ctx.state).toBe('ongoing');
      expect(renders).not.toContain('ready:idle');
    });

    // A leitura pode voltar com a ação confirmada E a seguinte, já aplicada no
    // servidor e ainda na fila. Reaplicar as duas sobre ela contaria o tempo
    // em dobro: a leitura é refeita.
    it('leitura que cruza uma confirmação é refeita: o tempo não conta em dobro', async () => {
      const T0 = Date.parse('2026-10-04T12:00:00.000Z');
      const relogio = jest.spyOn(Date, 'now').mockReturnValue(T0);
      try {
        const respostaDoIniciar = deferred<unknown>();
        send
          .mockImplementationOnce(() => respostaDoIniciar.promise)
          .mockImplementationOnce(() => new Promise(() => {}));
        listTasks.mockResolvedValue([task('t1', 'Inspeção'), task('t2', 'Reparo')]);
        await render();
        await act(async () => {
          await ctx.startTask({ id: 't1', title: 'Inspeção' });
        });
        relogio.mockReturnValue(T0 + 60_000);
        await act(async () => {
          await ctx.pauseJourney();
        });

        // Uma recarga sai antes de o servidor confirmar o iniciar...
        const antiga = deferred<JourneySession>();
        getJourney.mockReturnValueOnce(antiga.promise);
        await act(async () => {
          notify?.({ id: 'n7', domain: 'journey', targetId: 'order-1' });
        });
        // ...o iniciar é confirmado, e o pausar já vale no servidor, sem resposta ainda.
        const pausada: JourneySession = { state: 'paused', activeTaskId: 't1', startedAt: null, accumulatedSeconds: 60 };
        getJourney.mockResolvedValue(pausada);
        await act(async () => {
          respostaDoIniciar.resolve({ journey: ONGOING_SESSION, task: { id: 't1' } });
        });
        await flush();
        await act(async () => {
          antiga.resolve(pausada);
        });
        await flush();

        expect(ctx.state).toBe('paused');
        expect(ctx.accumulatedSeconds).toBe(60);
      } finally {
        relogio.mockRestore();
      }
    });

    it('ação recusada pelo servidor (409) sai da tela e a jornada é relida', async () => {
      send.mockRejectedValueOnce(Object.assign(new Error('Tarefa já concluída'), { status: 409, apiError: true }));
      listTasks.mockResolvedValue([task('t1', 'Inspeção', { status: 'done' })]);
      const tree = await render();
      const leiturasAntes = getJourney.mock.calls.length;

      await act(async () => {
        await ctx.startTask({ id: 't1', title: 'Inspeção' });
      });
      await flush();

      expect(mockQueue.getState().items).toEqual([]);
      expect(getJourney.mock.calls.length).toBeGreaterThan(leiturasAntes);
      expect(text(tree)).toContain('ready|idle|Inspeção:done');
    });
  });

  describe('aviso de sem conexão', () => {
    beforeEach(() => {
      listTasks.mockResolvedValue([task('t1', 'Inspeção')]);
    });

    it('não aparece enquanto o envio está saindo', async () => {
      await render();
      await act(async () => {
        await ctx.pauseJourney();
      });
      expect(ctx.waitingForSignal).toBe(false);
    });

    it('aparece depois de uma tentativa falhar, fecha, e volta só numa próxima espera', async () => {
      send.mockRejectedValue(semRede());
      await render();

      await act(async () => {
        await ctx.pauseJourney();
      });
      await flush();
      expect(ctx.waitingForSignal).toBe(true);

      act(() => ctx.dismissWaiting());
      expect(ctx.waitingForSignal).toBe(false);
      await act(async () => {
        await ctx.resumeJourney();
      });
      await flush();
      expect(ctx.waitingForSignal).toBe(false);

      // O sinal volta e a fila esvazia; a próxima falta de sinal avisa de novo.
      send.mockResolvedValue({ state: 'ongoing' });
      await act(async () => {
        await mockQueue.kick();
      });
      await flush();
      send.mockRejectedValue(semRede());
      await act(async () => {
        await ctx.pauseJourney();
      });
      await flush();
      expect(ctx.waitingForSignal).toBe(true);
    });

    it('envio de outro tipo parado não acende o aviso da jornada', async () => {
      send.mockRejectedValue(semRede());
      await render();

      await act(async () => {
        await mockQueue.enqueue({ kind: 'report.comment', reportId: 'r1', body: 'oi' });
      });
      await flush();

      expect(mockQueue.getState().stalled).toBe(true);
      expect(ctx.waitingForSignal).toBe(false);
    });
  });
});
