import * as Location from 'expo-location';
import {
  createPositionTracking,
  EVACUATION_TASK_OPTIONS,
  getPositionRuntime,
  LOCATION_TASK_OPTIONS,
  type LocationUpdates,
  type TrackingMode,
} from './positionTracking';
import { LOCATION_TASK_NAME } from './backgroundLocationTask';
import { createEvacuationWindowStore, EVACUATION_TRACKING_MAX_MS } from './evacuationWindow';
import { createTrackingWindowStore, TRACKING_MAX_MS } from './trackingWindow';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  ActivityType: { Other: 1 },
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
}));

function memoryStorage(): OutboxStorage {
  let text: string | null = null;
  return {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
  };
}

const T0 = Date.parse('2026-10-04T08:00:00.000Z');

function setup(opts: { supported?: boolean; started?: boolean } = {}) {
  let started = opts.started ?? false;
  const updates: jest.Mocked<LocationUpdates> = {
    start: jest.fn(async (_mode: TrackingMode) => {
      started = true;
    }),
    stop: jest.fn(async () => {
      started = false;
    }),
    hasStarted: jest.fn(async () => started),
  };
  const window = createTrackingWindowStore(memoryStorage());
  const evacuation = createEvacuationWindowStore(memoryStorage());
  const drain = jest.fn(async (_owner: string) => ({ sent: 0, outcome: 'empty' as const }));
  let agora = T0;
  const tracking = createPositionTracking({
    updates,
    window,
    evacuation,
    drainer: { drain },
    now: () => new Date(agora),
    supported: opts.supported ?? true,
  });
  return {
    tracking,
    updates,
    window,
    evacuation,
    drain,
    avancar: (ms: number) => {
      agora += ms;
    },
  };
}

describe('createPositionTracking', () => {
  it('começar abre a janela, liga as leituras e marca ativo', async () => {
    const { tracking, updates, window } = setup();
    await expect(tracking.start('u1')).resolves.toBe('tracking');
    expect(updates.start).toHaveBeenCalledTimes(1);
    expect(await window.read()).toEqual({ userId: 'u1', startedAt: new Date(T0).toISOString() });
    expect(tracking.isActive()).toBe(true);
  });

  it('começar de novo com as leituras ligadas não religa', async () => {
    const { tracking, updates } = setup();
    await tracking.start('u1');
    await tracking.start('u1');
    expect(updates.start).toHaveBeenCalledTimes(1);
  });

  it('depois das 12 h, não religa e desliga o que estiver ligado', async () => {
    const { tracking, updates, avancar } = setup();
    await tracking.start('u1');
    avancar(TRACKING_MAX_MS);
    await expect(tracking.start('u1')).resolves.toBe('expired');
    expect(updates.stop).toHaveBeenCalledTimes(1);
    expect(tracking.isActive()).toBe(false);
  });

  it('falha ao ligar (permissão negada) não marca ativo', async () => {
    const { tracking, updates } = setup();
    updates.start.mockRejectedValueOnce(new Error('Not authorized'));
    await expect(tracking.start('u1')).resolves.toBe('failed');
    expect(tracking.isActive()).toBe(false);
  });

  it('sem suporte (web), não toca nas leituras', async () => {
    const { tracking, updates } = setup({ supported: false });
    await expect(tracking.start('u1')).resolves.toBe('unsupported');
    await tracking.stop();
    await tracking.halt();
    expect(updates.start).not.toHaveBeenCalled();
    expect(updates.hasStarted).not.toHaveBeenCalled();
    expect(updates.stop).not.toHaveBeenCalled();
  });

  it('parar fecha a janela, desliga as leituras e desmarca', async () => {
    const { tracking, updates, window } = setup();
    await tracking.start('u1');
    await tracking.stop();
    expect(await window.read()).toBeNull();
    expect(updates.stop).toHaveBeenCalledTimes(1);
    expect(tracking.isActive()).toBe(false);
  });

  it('parar sem leituras ligadas só fecha a janela', async () => {
    const { tracking, updates } = setup();
    await tracking.stop();
    expect(updates.stop).not.toHaveBeenCalled();
  });

  it('interromper (12 h vistas pela tarefa) desliga sem fechar a janela', async () => {
    const { tracking, updates, window } = setup();
    await tracking.start('u1');
    await tracking.halt();
    expect(updates.stop).toHaveBeenCalledTimes(1);
    expect(await window.read()).not.toBeNull();
    expect(tracking.isActive()).toBe(false);
  });

  it('falha ao desligar não derruba quem chamou', async () => {
    const { tracking, updates } = setup();
    await tracking.start('u1');
    updates.stop.mockRejectedValueOnce(new Error('task not found'));
    await expect(tracking.stop()).resolves.toBeUndefined();
    expect(tracking.isActive()).toBe(false);
  });

  it('disco que falha ao abrir a janela não liga e não rejeita', async () => {
    const { tracking, updates, window } = setup();
    jest.spyOn(window, 'open').mockRejectedValueOnce(new Error('disco'));
    await expect(tracking.start('u1')).resolves.toBe('failed');
    expect(updates.start).not.toHaveBeenCalled();
  });

  it('disco que falha ao fechar a janela ainda desliga as leituras', async () => {
    const { tracking, updates, window } = setup();
    await tracking.start('u1');
    jest.spyOn(window, 'close').mockRejectedValueOnce(new Error('disco'));
    await expect(tracking.stop()).resolves.toBeUndefined();
    expect(updates.stop).toHaveBeenCalledTimes(1);
    expect(tracking.isActive()).toBe(false);
  });

  // Encerrar a jornada e começar outra em seguida: o desligar ainda em curso
  // não pode terminar depois do ligar e deixar a jornada sem rastreio.
  it('desligar e ligar em seguida acontecem na ordem pedida', async () => {
    const { tracking, updates, window } = setup();
    await tracking.start('u1');
    const desligar = updates.stop.getMockImplementation()!;
    let soltar!: () => void;
    const trava = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    updates.stop.mockImplementationOnce(async () => {
      await trava;
      await desligar();
    });

    const parou = tracking.stop();
    const ligou = tracking.start('u1');
    await new Promise((r) => setImmediate(r));
    soltar();
    await Promise.all([parou, ligou]);

    expect(tracking.isActive()).toBe(true);
    expect(await updates.hasStarted()).toBe(true);
    expect(await window.read()).not.toBeNull();
  });

  it('avisa quem assina a cada mudança de ativo, e para de avisar ao sair', async () => {
    const { tracking } = setup();
    const ouvinte = jest.fn();
    const sair = tracking.subscribe(ouvinte);
    await tracking.start('u1');
    await tracking.start('u1');
    await tracking.stop();
    expect(ouvinte).toHaveBeenCalledTimes(2);
    sair();
    await tracking.start('u1');
    expect(ouvinte).toHaveBeenCalledTimes(2);
  });

  it('drenar repassa o dono e engole a falha', async () => {
    const { tracking, drain } = setup();
    drain.mockRejectedValueOnce(new Error('rede'));
    await expect(tracking.drain('u1')).resolves.toBeUndefined();
    expect(drain).toHaveBeenCalledWith('u1');
  });
});

// A jornada que veio da cópia guardada (app aberto sem sinal) só retoma o
// rastreio que já estava em curso, por exemplo depois de o celular reiniciar.
// Abrir janela nova é decisão de quem leu o servidor.
describe('createPositionTracking, retomar', () => {
  it('com a janela da pessoa aberta, liga as leituras', async () => {
    const { tracking, updates, window } = setup();
    await window.open('u1', new Date(T0));

    await expect(tracking.resume('u1')).resolves.toBe('tracking');

    expect(updates.start).toHaveBeenCalledTimes(1);
    expect(tracking.isActive()).toBe(true);
  });

  it('sem janela, não abre janela nem liga', async () => {
    const { tracking, updates, window } = setup();

    await expect(tracking.resume('u1')).resolves.toBe('skipped');

    expect(updates.start).not.toHaveBeenCalled();
    expect(await window.read()).toBeNull();
    expect(tracking.isActive()).toBe(false);
  });

  it('com a janela de outra pessoa, não liga', async () => {
    const { tracking, updates, window } = setup();
    await window.open('u2', new Date(T0));

    await expect(tracking.resume('u1')).resolves.toBe('skipped');

    expect(updates.start).not.toHaveBeenCalled();
    expect(await window.read()).toEqual({ userId: 'u2', startedAt: new Date(T0).toISOString() });
  });

  it('depois das 12 h, não liga', async () => {
    const { tracking, updates, window, avancar } = setup();
    await window.open('u1', new Date(T0));
    avancar(TRACKING_MAX_MS);

    await expect(tracking.resume('u1')).resolves.toBe('skipped');

    expect(updates.start).not.toHaveBeenCalled();
  });

  it('o sistema recusando as leituras devolve falha', async () => {
    const { tracking, updates, window } = setup();
    await window.open('u1', new Date(T0));
    updates.start.mockRejectedValueOnce(new Error('sem permissão'));

    await expect(tracking.resume('u1')).resolves.toBe('failed');
    expect(tracking.isActive()).toBe(false);
  });

  it('sem suporte (web), não toca nas leituras', async () => {
    const { tracking, updates } = setup({ supported: false });

    await expect(tracking.resume('u1')).resolves.toBe('unsupported');
    expect(updates.start).not.toHaveBeenCalled();
  });
});

// O fim da jornada desliga só o que é da jornada: com evacuação em curso, as
// leituras seguem até o gestor encerrar.
describe('createPositionTracking, fim da jornada', () => {
  it('sem evacuação, fecha a janela e desliga', async () => {
    const { tracking, updates, window } = setup();
    await tracking.start('u1');
    await tracking.stopJourney();
    expect(await window.read()).toBeNull();
    expect(updates.stop).toHaveBeenCalledTimes(1);
    expect(tracking.isActive()).toBe(false);
  });

  it('com evacuação em curso, fecha a janela e mantém as leituras', async () => {
    const { tracking, updates, window } = setup();
    await tracking.start('u1');
    await tracking.startEvacuation('u1', 'e1');
    await tracking.stopJourney();
    expect(await window.read()).toBeNull();
    expect(updates.stop).not.toHaveBeenCalled();
    expect(tracking.isActive()).toBe(true);
  });
});

// Com evacuação ativa o rastreio liga mesmo sem jornada, sem o filtro de 60 s,
// e a notificação fixa do Android diz que é a evacuação. Trocar a notificação
// pede religar as leituras com as opções da evacuação.
describe('createPositionTracking, evacuação', () => {
  it('sem jornada, grava a evacuação e liga as leituras da evacuação', async () => {
    const { tracking, updates, evacuation } = setup();
    await expect(tracking.startEvacuation('u1', 'e1')).resolves.toBe('tracking');
    expect(updates.start).toHaveBeenCalledWith('evacuation');
    expect(await evacuation.read()).toEqual({
      userId: 'u1',
      evacuationId: 'e1',
      startedAt: new Date(T0).toISOString(),
    });
    expect(tracking.isActive()).toBe(true);
  });

  it('com a jornada em curso, religa com as opções da evacuação', async () => {
    const { tracking, updates } = setup();
    await tracking.start('u1');
    await tracking.startEvacuation('u1', 'e1');
    expect(updates.start.mock.calls).toEqual([['journey'], ['evacuation']]);
  });

  it('pedir de novo a mesma evacuação não religa', async () => {
    const { tracking, updates } = setup();
    await tracking.startEvacuation('u1', 'e1');
    await tracking.startEvacuation('u1', 'e1');
    expect(updates.start).toHaveBeenCalledTimes(1);
  });

  it('começar a jornada durante a evacuação não troca as opções', async () => {
    const { tracking, updates } = setup();
    await tracking.startEvacuation('u1', 'e1');
    await expect(tracking.start('u1')).resolves.toBe('tracking');
    expect(updates.start.mock.calls).toEqual([['evacuation']]);
  });

  it('jornada vencida durante a evacuação não desliga', async () => {
    const { tracking, updates, avancar } = setup();
    await tracking.start('u1');
    avancar(TRACKING_MAX_MS);
    await tracking.startEvacuation('u1', 'e1');
    await expect(tracking.start('u1')).resolves.toBe('expired');
    expect(updates.stop).not.toHaveBeenCalled();
    expect(tracking.isActive()).toBe(true);
  });

  it('encerrada, sem jornada: apaga a evacuação e desliga', async () => {
    const { tracking, updates, evacuation } = setup();
    await tracking.startEvacuation('u1', 'e1');
    await tracking.endEvacuation();
    expect(await evacuation.read()).toBeNull();
    expect(updates.stop).toHaveBeenCalledTimes(1);
    expect(tracking.isActive()).toBe(false);
  });

  it('encerrada, com jornada: volta às opções da jornada e segue ativo', async () => {
    const { tracking, updates } = setup();
    await tracking.start('u1');
    await tracking.startEvacuation('u1', 'e1');
    await tracking.endEvacuation();
    expect(updates.start.mock.calls).toEqual([['journey'], ['evacuation'], ['journey']]);
    expect(updates.stop).not.toHaveBeenCalled();
    expect(tracking.isActive()).toBe(true);
  });

  // Com o app em segundo plano quem vê o encerramento é a tarefa, que apaga a
  // evacuação sem poder religar. A volta da jornada ao primeiro plano religa
  // com as opções dela, e a notificação deixa de falar em evacuação.
  it('evacuação apagada pela tarefa: a jornada religa com as opções dela', async () => {
    const { tracking, updates, evacuation } = setup();
    await tracking.start('u1');
    await tracking.startEvacuation('u1', 'e1');
    await evacuation.close();
    await tracking.start('u1');
    expect(updates.start.mock.calls).toEqual([['journey'], ['evacuation'], ['journey']]);
  });

  // Com o app em segundo plano, a tarefa grava a evacuação que começou durante
  // a jornada, sem poder religar. Na volta ao primeiro plano a consulta do app
  // pede a mesma evacuação: o início gravado fica (o teto não recomeça) e as
  // leituras religam com as opções da evacuação, para a notificação dizer que
  // é ela. Vale também num processo novo, que não sabe o que foi ligado.
  it('evacuação gravada pela tarefa: a volta ao primeiro plano religa com as opções dela', async () => {
    const { tracking, updates, evacuation, avancar } = setup();
    await tracking.start('u1');
    await evacuation.open('u1', 'e1', new Date(T0));
    avancar(30_000);
    await expect(tracking.startEvacuation('u1', 'e1')).resolves.toBe('tracking');
    expect(updates.start.mock.calls).toEqual([['journey'], ['evacuation']]);
    expect((await evacuation.read())?.startedAt).toBe(new Date(T0).toISOString());

    const novo = setup({ started: true });
    await novo.window.open('u1', new Date(T0));
    await novo.evacuation.open('u1', 'e1', new Date(T0));
    await novo.tracking.startEvacuation('u1', 'e1');
    expect(novo.updates.start.mock.calls).toEqual([['evacuation']]);
  });

  // Com o app na frente, a tarefa (60 s) pode ver o encerramento antes da
  // consulta da tela (30 s) e apagar a evacuação. O fim visto depois pela tela
  // ainda precisa religar com as opções da jornada: sem isso a notificação
  // fixa seguia "Evacuação em andamento" até o app ir e voltar do fundo.
  it('evacuação apagada pela tarefa: o fim visto pela tela volta às opções da jornada', async () => {
    const { tracking, updates, evacuation } = setup();
    await tracking.start('u1');
    await tracking.startEvacuation('u1', 'e1');
    await evacuation.close();
    await tracking.endEvacuation();
    expect(updates.start.mock.calls).toEqual([['journey'], ['evacuation'], ['journey']]);
    expect(tracking.isActive()).toBe(true);
    // Uma vez nas opções da jornada, o fim repetido não religa de novo.
    await tracking.endEvacuation();
    expect(updates.start).toHaveBeenCalledTimes(3);
  });

  it('evacuação apagada pela tarefa, sem jornada: o fim visto pela tela desliga', async () => {
    const { tracking, updates, evacuation } = setup();
    await tracking.startEvacuation('u1', 'e1');
    await evacuation.close();
    await tracking.endEvacuation();
    expect(updates.stop).toHaveBeenCalledTimes(1);
    expect(tracking.isActive()).toBe(false);
  });

  // Religar com o app em segundo plano o Android pode recusar. As leituras
  // seguem ligadas com as opções da evacuação, e o processo não pode esquecer
  // isso: a volta ao primeiro plano tenta de novo.
  it('religar recusado em segundo plano: o fim seguinte tenta de novo', async () => {
    const { tracking, updates } = setup();
    await tracking.start('u1');
    await tracking.startEvacuation('u1', 'e1');
    updates.start.mockRejectedValueOnce(new Error('ForegroundServiceStartNotAllowedException'));
    await tracking.endEvacuation();
    await tracking.endEvacuation();
    expect(updates.start.mock.calls).toEqual([['journey'], ['evacuation'], ['journey'], ['journey']]);
    expect(tracking.isActive()).toBe(true);
  });

  it('religar recusado em segundo plano: a volta da jornada também tenta de novo', async () => {
    const { tracking, updates } = setup();
    await tracking.start('u1');
    await tracking.startEvacuation('u1', 'e1');
    updates.start.mockRejectedValueOnce(new Error('ForegroundServiceStartNotAllowedException'));
    await tracking.endEvacuation();
    await tracking.resume('u1');
    expect(updates.start.mock.calls).toEqual([['journey'], ['evacuation'], ['journey'], ['journey']]);
  });

  it('encerrar sem evacuação gravada não mexe nas leituras da jornada', async () => {
    const { tracking, updates } = setup();
    await tracking.start('u1');
    await tracking.endEvacuation();
    expect(updates.start).toHaveBeenCalledTimes(1);
    expect(updates.stop).not.toHaveBeenCalled();
    expect(tracking.isActive()).toBe(true);
  });

  it('passado o teto, não liga', async () => {
    const { tracking, updates, avancar } = setup();
    await tracking.startEvacuation('u1', 'e1');
    avancar(EVACUATION_TRACKING_MAX_MS);
    await expect(tracking.startEvacuation('u1', 'e1')).resolves.toBe('expired');
    expect(updates.stop).toHaveBeenCalledTimes(1);
    expect(tracking.isActive()).toBe(false);
  });

  it('o sistema recusando as leituras devolve falha', async () => {
    const { tracking, updates } = setup();
    updates.start.mockRejectedValueOnce(new Error('sem permissão'));
    await expect(tracking.startEvacuation('u1', 'e1')).resolves.toBe('failed');
    expect(tracking.isActive()).toBe(false);
  });

  it('logout apaga evacuação e janela e desliga', async () => {
    const { tracking, updates, window, evacuation } = setup();
    await tracking.start('u1');
    await tracking.startEvacuation('u1', 'e1');
    await tracking.stop();
    expect(await window.read()).toBeNull();
    expect(await evacuation.read()).toBeNull();
    expect(updates.stop).toHaveBeenCalledTimes(1);
    expect(tracking.isActive()).toBe(false);
  });

  // Processo novo (app reaberto) não sabe com que opções as leituras foram
  // ligadas. Na evacuação religa uma vez para a notificação ficar certa; na
  // jornada, a de sempre, não mexe.
  it('processo novo com as leituras ligadas: a evacuação religa uma vez, a jornada não', async () => {
    const jornada = setup({ started: true });
    await jornada.window.open('u1', new Date(T0));
    await jornada.tracking.resume('u1');
    expect(jornada.updates.start).not.toHaveBeenCalled();

    const evacuacao = setup({ started: true });
    await evacuacao.tracking.startEvacuation('u1', 'e1');
    await evacuacao.tracking.startEvacuation('u1', 'e1');
    expect(evacuacao.updates.start.mock.calls).toEqual([['evacuation']]);
  });

  it('sem suporte (web), não toca nas leituras', async () => {
    const { tracking, updates } = setup({ supported: false });
    await expect(tracking.startEvacuation('u1', 'e1')).resolves.toBe('unsupported');
    await tracking.endEvacuation();
    await tracking.stopJourney();
    expect(updates.start).not.toHaveBeenCalled();
    expect(updates.stop).not.toHaveBeenCalled();
  });
});

describe('EVACUATION_TASK_OPTIONS', () => {
  it('as mesmas leituras da jornada, com a notificação da evacuação', () => {
    expect(EVACUATION_TASK_OPTIONS).toMatchObject({
      accuracy: LOCATION_TASK_OPTIONS.accuracy,
      timeInterval: LOCATION_TASK_OPTIONS.timeInterval,
      pausesUpdatesAutomatically: false,
      foregroundService: { notificationTitle: 'Evacuação em andamento', killServiceOnDestroy: false },
    });
  });
});

describe('LOCATION_TASK_OPTIONS', () => {
  it('precisão alta, iPhone sem pausa automática, Android por serviço que sobrevive ao app fechado', () => {
    expect(LOCATION_TASK_OPTIONS).toMatchObject({
      accuracy: Location.Accuracy.High,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: { killServiceOnDestroy: false },
    });
    expect(LOCATION_TASK_OPTIONS.foregroundService?.notificationTitle).toBeTruthy();
  });
});

describe('getPositionRuntime', () => {
  it('uma instância por processo, ligada às leituras reais pelo nome da tarefa', async () => {
    const runtime = getPositionRuntime();
    expect(getPositionRuntime()).toBe(runtime);

    // Sem `File` no dublê do expo-file-system, a janela não abre e o pedido
    // falha sem rejeitar: a montagem real não pode derrubar quem chama.
    await expect(runtime.tracking.start('u1')).resolves.toBe('failed');

    await runtime.tracking.halt();
    expect(Location.hasStartedLocationUpdatesAsync).toHaveBeenCalledWith(LOCATION_TASK_NAME);
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(LOCATION_TASK_NAME);
  });
});
