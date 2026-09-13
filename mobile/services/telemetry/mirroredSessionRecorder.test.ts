import type { SwiWatchControlStatus, WatchControl } from '../../modules/swi-watch-control';
import {
  createTelemetryOutbox,
  type OutboxEvent,
  type OutboxStorage,
  type TelemetryOutbox,
} from './telemetryOutbox';
import { createMirroredSessionRecorder } from './mirroredSessionRecorder';

// O gravador é a ponta que liga a sessão espelhada à fila. O que importa aqui
// é o que sobra na fila depois de cada estado do relógio, então a fila é a
// real, sobre armazenamento em memória, e não um dublê.

function memoryStorage(): OutboxStorage {
  let text: string | null = null;
  return {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
  };
}

// A fila só aceita UUID, e o teste quer falar em 'sessA' e 'ev1'. O rótulo
// vira os últimos bytes de um UUID v4 fixo.
const uid = (label: string) =>
  `00000000-0000-4000-8000-${Buffer.from(label, 'ascii').toString('hex').padStart(12, '0')}`;

// Gerador de identificadores previsível: devolve os rótulos na ordem pedida e
// acusa quando o gravador pede mais do que o teste previu.
function ids(...labels: string[]) {
  const fila = [...labels];
  return jest.fn(() => {
    const label = fila.shift();
    if (label === undefined) throw new Error('o gravador pediu mais identificadores que o previsto');
    return uid(label);
  });
}

// Dublê do invólucro: guarda o ouvinte para o teste entregar o estado inteiro,
// como o invólucro faz a cada mudança.
function fakeControl(initial: SwiWatchControlStatus | null = null) {
  let listener: ((status: SwiWatchControlStatus) => void) | null = null;
  const unsubscribe = jest.fn(() => {
    listener = null;
  });
  const control: WatchControl = {
    supported: true,
    getStatus: () => initial,
    requestAuthorization: async () => true,
    startMonitoring: async () => true,
    subscribe: (l) => {
      listener = l;
      return unsubscribe;
    },
    request: async () => ({ status: 200, body: '{}' }),
    hasDeviceCredential: () => true,
    clearDeviceCredential: () => undefined,
    rotateInbox: () => [],
  };
  const emit = (status: Partial<SwiWatchControlStatus>) => {
    if (!listener) throw new Error('ninguém assinou o controle');
    listener({
      session: 'none',
      sessionChangedAt: null,
      lastSample: null,
      // Este arquivo inteiro exercita o caminho LEGADO, que é o que o gravador
      // atende: no formato novo a leitura chega pelo arquivo durável.
      watchProtocol: 'legacy',
      ...status,
    });
  };
  return { control, emit, unsubscribe, hasListener: () => listener !== null };
}

const T0 = '2026-09-07T12:00:00.000Z';
const T1 = '2026-09-07T12:00:05.000Z';
const T2 = '2026-09-07T12:00:10.000Z';
const T3 = '2026-09-07T12:00:15.000Z';

const running = (lastSample: SwiWatchControlStatus['lastSample'] = null): SwiWatchControlStatus => ({
  session: 'running',
  watchProtocol: null,
  sessionChangedAt: T0,
  lastSample,
});

// Macrotarefa: todas as promessas da fila e do gravador resolvem antes dela.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function recorder(
  control: WatchControl,
  outbox: TelemetryOutbox,
  uuid: () => string,
  onEnqueued: () => void = () => undefined,
) {
  return createMirroredSessionRecorder({ outbox, control, onEnqueued, uuid });
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe('mirroredSessionRecorder, sessão', () => {
  it('nasce ao running e o id é o mesmo em duas amostras seguidas', async () => {
    const { control, emit } = fakeControl();
    const outbox = createTelemetryOutbox(memoryStorage());
    recorder(control, outbox, ids('sessA', 'ev1', 'ev2')).start();

    emit(running());
    emit(running({ bpm: 70, measuredAt: T1 }));
    emit(running({ bpm: 71, measuredAt: T2 }));
    await flush();

    const eventos = await outbox.pending();
    expect(eventos.map((e) => e.monitoringSessionId)).toEqual([uid('sessA'), uid('sessA')]);
  });

  it('ended esquece a sessão na fila com o id certo, e a próxima running gera outro', async () => {
    const { control, emit } = fakeControl();
    const outbox = createTelemetryOutbox(memoryStorage());
    const forget = jest.spyOn(outbox, 'forgetSession');
    recorder(control, outbox, ids('sessA', 'ev1', 'sessB', 'ev2')).start();

    emit(running({ bpm: 70, measuredAt: T1 }));
    await flush();
    emit({ session: 'ended', sessionChangedAt: T2, lastSample: { bpm: 70, measuredAt: T1 } });
    await flush();
    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledWith(uid('sessA'));

    emit({ session: 'running', sessionChangedAt: T3, lastSample: { bpm: 72, measuredAt: T3 } });
    await flush();
    const eventos = await outbox.pending();
    expect(eventos.map((e) => e.monitoringSessionId)).toEqual([uid('sessA'), uid('sessB')]);
  });

  it('sessão que já estava ativa quando o gravador começou nasce na primeira amostra', async () => {
    const { control, emit } = fakeControl(running());
    const outbox = createTelemetryOutbox(memoryStorage());
    recorder(control, outbox, ids('sessA', 'ev1')).start();

    emit(running({ bpm: 70, measuredAt: T1 }));
    await flush();

    expect((await outbox.pending()).map((e) => e.monitoringSessionId)).toEqual([uid('sessA')]);
  });
});

describe('mirroredSessionRecorder, amostra', () => {
  it('vira evento com os campos exatos do contrato', async () => {
    const { control, emit } = fakeControl();
    const outbox = createTelemetryOutbox(memoryStorage());
    recorder(control, outbox, ids('sessA', 'ev1')).start();

    emit(running({ bpm: 70.5, measuredAt: T1 }));
    await flush();

    const esperado: OutboxEvent = {
      eventId: uid('ev1'),
      monitoringSessionId: uid('sessA'),
      sequence: 0,
      eventTime: T1,
      origin: 'REAL',
      measurements: { heartRate: { value: 70.5, unit: 'bpm', source: 'APPLE_WATCH' } },
    };
    expect(await outbox.pending()).toEqual([esperado]);
  });

  // O invólucro reenvia o estado inteiro a cada mudança: a amostra chega de
  // novo quando só a sessão mudou.
  it('a mesma amostra reentregue com a sessão inalterada não vira segundo evento', async () => {
    const { control, emit } = fakeControl();
    const outbox = createTelemetryOutbox(memoryStorage());
    recorder(control, outbox, ids('sessA', 'ev1')).start();

    emit(running({ bpm: 70, measuredAt: T1 }));
    emit(running({ bpm: 70, measuredAt: T1 }));
    await flush();
    emit(running({ bpm: 70, measuredAt: T1 }));
    await flush();

    expect(await outbox.pending()).toHaveLength(1);
  });

  // Uma amostra que já estava no invólucro antes de o gravador começar pode
  // ser de uma sessão anterior; atribuí-la à sessão nova seria inventar dado.
  it('amostra que já existia antes de o gravador começar não vira evento', async () => {
    const { control, emit } = fakeControl(running({ bpm: 65, measuredAt: T0 }));
    const outbox = createTelemetryOutbox(memoryStorage());
    recorder(control, outbox, ids('sessA', 'ev1')).start();

    emit(running({ bpm: 65, measuredAt: T0 }));
    await flush();
    expect(await outbox.pending()).toHaveLength(0);

    emit(running({ bpm: 66, measuredAt: T1 }));
    await flush();
    expect((await outbox.pending()).map((e) => e.eventTime)).toEqual([T1]);
  });

  it('sem sessão corrente é descartada, e o aviso sai uma vez por sessão perdida', async () => {
    const { control, emit } = fakeControl();
    const outbox = createTelemetryOutbox(memoryStorage());
    const append = jest.spyOn(outbox, 'append');
    recorder(control, outbox, ids('sessA', 'ev1')).start();

    emit({ session: 'none', sessionChangedAt: null, lastSample: { bpm: 70, measuredAt: T1 } });
    emit({ session: 'none', sessionChangedAt: null, lastSample: { bpm: 71, measuredAt: T2 } });
    await flush();

    expect(append).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/sem sessão/i);

    // Sessão nova, descarte novo: o aviso volta a valer uma vez.
    emit(running({ bpm: 72, measuredAt: T3 }));
    await flush();
    emit({ session: 'ended', sessionChangedAt: T3, lastSample: { bpm: 72, measuredAt: T3 } });
    emit({
      session: 'ended',
      watchProtocol: null,
      sessionChangedAt: T3,
      lastSample: { bpm: 73, measuredAt: '2026-09-07T12:00:20.000Z' },
    });
    await flush();
    expect(append).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('mirroredSessionRecorder, ordem', () => {
  it('onEnqueued só é chamado depois de append resolver', async () => {
    const { control, emit } = fakeControl();
    const outbox = createTelemetryOutbox(memoryStorage());
    const append = jest.spyOn(outbox, 'append');
    const onEnqueued = jest.fn();
    recorder(control, outbox, ids('sessA', 'ev1'), onEnqueued).start();

    emit(running({ bpm: 70, measuredAt: T1 }));
    // Antes das promessas resolverem, o append já foi pedido e o aviso ainda não.
    await Promise.resolve();
    expect(onEnqueued).not.toHaveBeenCalled();
    await flush();

    expect(append).toHaveBeenCalledTimes(1);
    expect(onEnqueued).toHaveBeenCalledTimes(1);
    expect(append.mock.invocationCallOrder[0]).toBeLessThan(onEnqueued.mock.invocationCallOrder[0]);
  });

  it('amostras que chegam durante um append lento saem com sequência 0, 1, 2 na ordem', async () => {
    const { control, emit } = fakeControl();
    const real = createTelemetryOutbox(memoryStorage());
    // Primeiro append segura até o teste soltar; os outros passam direto.
    let soltar!: () => void;
    const porta = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    let primeiro = true;
    const outbox: TelemetryOutbox = {
      ...real,
      append: async (event) => {
        if (primeiro) {
          primeiro = false;
          await porta;
        }
        return real.append(event);
      },
    };
    const onEnqueued = jest.fn();
    recorder(control, outbox, ids('sessA', 'ev1', 'ev2', 'ev3'), onEnqueued).start();

    emit(running({ bpm: 70, measuredAt: T1 }));
    await flush();
    emit(running({ bpm: 71, measuredAt: T2 }));
    emit(running({ bpm: 72, measuredAt: T3 }));
    await flush();
    expect(await real.pending()).toHaveLength(0);
    expect(onEnqueued).not.toHaveBeenCalled();

    soltar();
    await flush();

    const eventos = await real.pending();
    expect(eventos.map((e) => [e.eventId, e.sequence, e.eventTime])).toEqual([
      [uid('ev1'), 0, T1],
      [uid('ev2'), 1, T2],
      [uid('ev3'), 2, T3],
    ]);
    expect(onEnqueued).toHaveBeenCalledTimes(3);
  });

  // Disco que recusa uma amostra não pode travar as seguintes, nem avisar
  // envio de algo que não entrou.
  it('append que rejeita não chama onEnqueued e a próxima amostra segue', async () => {
    const { control, emit } = fakeControl();
    const real = createTelemetryOutbox(memoryStorage());
    let falhar = true;
    const outbox: TelemetryOutbox = {
      ...real,
      append: async (event) => {
        if (falhar) {
          falhar = false;
          throw new Error('disco cheio');
        }
        return real.append(event);
      },
    };
    const onEnqueued = jest.fn();
    recorder(control, outbox, ids('sessA', 'ev1', 'ev2'), onEnqueued).start();

    emit(running({ bpm: 70, measuredAt: T1 }));
    await flush();
    expect(onEnqueued).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    emit(running({ bpm: 71, measuredAt: T2 }));
    await flush();
    expect(onEnqueued).toHaveBeenCalledTimes(1);
    expect((await real.pending()).map((e) => e.eventId)).toEqual([uid('ev2')]);
  });
});

describe('mirroredSessionRecorder, parar', () => {
  it('cancelar a assinatura para de gravar', async () => {
    const { control, emit, unsubscribe, hasListener } = fakeControl();
    const outbox = createTelemetryOutbox(memoryStorage());
    const stop = recorder(control, outbox, ids('sessA', 'ev1')).start();

    emit(running({ bpm: 70, measuredAt: T1 }));
    await flush();
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(hasListener()).toBe(false);

    expect(await outbox.pending()).toHaveLength(1);
  });

  // Um ouvinte que o invólucro ainda chame depois do cancelamento não pode
  // gravar: a tela que parou não está mais olhando.
  it('estado que ainda chega depois de parar é ignorado', async () => {
    let ouvinte: ((status: SwiWatchControlStatus) => void) | null = null;
    const { control } = fakeControl();
    const teimoso: WatchControl = {
      ...control,
      subscribe: (l) => {
        ouvinte = l;
        return () => undefined;
      },
    };
    const outbox = createTelemetryOutbox(memoryStorage());
    const stop = recorder(teimoso, outbox, ids('sessA', 'ev1')).start();
    stop();

    ouvinte!(running({ bpm: 70, measuredAt: T1 }));
    await flush();
    expect(await outbox.pending()).toHaveLength(0);
  });

  // O id da sessão morre com o gravador; o contador dela na fila não pode
  // ficar para sempre no arquivo.
  it('parar esquece a sessão corrente na fila', async () => {
    const { control, emit } = fakeControl();
    const outbox = createTelemetryOutbox(memoryStorage());
    const forget = jest.spyOn(outbox, 'forgetSession');
    const stop = recorder(control, outbox, ids('sessA')).start();

    emit(running());
    await flush();
    stop();
    await flush();

    expect(forget).toHaveBeenCalledWith(uid('sessA'));
  });
});

describe('convivência com o formato novo do relógio', () => {
  it('não grava nada quando o relógio fala o formato novo', async () => {
    // No formato novo a leitura chega pelo arquivo durável, com identificador e
    // sequência vindos do relógio. Se este gravador também agisse, ele geraria
    // OUTRO identificador para a MESMA leitura, e o backend, que só reconhece
    // repetição pelo identificador do evento, gravaria as duas.
    const { control, emit } = fakeControl();
    const outbox = createTelemetryOutbox(memoryStorage());
    const onEnqueued = jest.fn();
    // Identificadores disponíveis de propósito: se o gravador agisse, ele
    // conseguiria gravar, e o teste falharia. Sem isto o gerador lançaria e o
    // teste passaria pelo motivo errado.
    createMirroredSessionRecorder({
      outbox,
      control,
      onEnqueued,
      uuid: ids('sessA', 'ev1'),
    }).start();

    emit({ session: 'running', watchProtocol: 'v1' });
    emit({
      session: 'running',
      watchProtocol: 'v1',
      lastSample: { bpm: 72, measuredAt: T1 },
    });
    await flush();

    expect(onEnqueued).not.toHaveBeenCalled();
    expect(await outbox.pending()).toEqual([]);
  });

  it('continua gravando quando o relógio ainda é o antigo', async () => {
    // Janela real: o app do relógio se instala no ritmo do sistema, então há um
    // período de iPhone novo com relógio velho. Perder leitura nesse período
    // seria pior que o identificador vir do telefone.
    const { control, emit } = fakeControl();
    const outbox = createTelemetryOutbox(memoryStorage());
    const onEnqueued = jest.fn();
    createMirroredSessionRecorder({
      outbox,
      control,
      onEnqueued,
      uuid: ids('sessA', 'ev1'),
    }).start();

    emit(running());
    emit(running({ bpm: 72, measuredAt: T1 }));
    await flush();

    expect(onEnqueued).toHaveBeenCalledTimes(1);
    expect(await outbox.pending()).toHaveLength(1);
  });
});
