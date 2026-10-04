import * as Location from 'expo-location';
import {
  createPositionTracking,
  getPositionRuntime,
  LOCATION_TASK_OPTIONS,
  type LocationUpdates,
} from './positionTracking';
import { LOCATION_TASK_NAME } from './backgroundLocationTask';
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

function setup(opts: { supported?: boolean } = {}) {
  let started = false;
  const updates: jest.Mocked<LocationUpdates> = {
    start: jest.fn(async () => {
      started = true;
    }),
    stop: jest.fn(async () => {
      started = false;
    }),
    hasStarted: jest.fn(async () => started),
  };
  const window = createTrackingWindowStore(memoryStorage());
  const drain = jest.fn(async (_owner: string) => ({ sent: 0, outcome: 'empty' as const }));
  let agora = T0;
  const tracking = createPositionTracking({
    updates,
    window,
    drainer: { drain },
    now: () => new Date(agora),
    supported: opts.supported ?? true,
  });
  return {
    tracking,
    updates,
    window,
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
