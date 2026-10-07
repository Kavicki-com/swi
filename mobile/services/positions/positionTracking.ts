import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { LOCATION_TASK_NAME } from './backgroundLocationTask';
import { createPositionDrainer, type PositionDrainer } from './positionDrain';
import { createFilePositionStorage, createPositionOutbox, type PositionOutbox } from './positionOutbox';
import { getPositionsBackend } from './getPositionsBackend';
import {
  createTrackingWindowStore,
  isWindowOpen,
  TRACKING_WINDOW_FILE_NAME,
  type TrackingWindowStore,
} from './trackingWindow';

// Liga e desliga o rastreio em segundo plano. Quem decide QUANDO é a jornada
// (useJourneyTracking) e o logout; aqui fica o COMO: a janela das 12 h, as
// leituras do sistema e o aviso de "rastreio ativo", que cala o heartbeat
// para a mesma posição não sair por dois caminhos.

/** As três operações do sistema que o controle usa, injetáveis no teste. */
export interface LocationUpdates {
  start(): Promise<void>;
  stop(): Promise<void>;
  hasStarted(): Promise<boolean>;
}

/** `skipped`: retomar sem janela aberta da pessoa, e nada foi ligado. */
export type StartResult = 'tracking' | 'expired' | 'failed' | 'unsupported' | 'skipped';

export interface PositionTracking {
  /**
   * Abre (ou retoma) a janela da pessoa e liga as leituras. `failed` quando o
   * sistema recusa, em geral por falta da permissão de uso.
   */
  start(userId: string): Promise<StartResult>;
  /**
   * Religa só a janela que já estava aberta, da pessoa e dentro das 12 h; sem
   * ela, `skipped` e nada muda. É o que a jornada vinda da cópia guardada pode
   * pedir: abrir janela nova fica para quem leu o servidor.
   */
  resume(userId: string): Promise<StartResult>;
  /** Fim da jornada ou logout: fecha a janela e desliga. */
  stop(): Promise<void>;
  /** As 12 h vencidas vistas pela tarefa: desliga e mantém a janela. */
  halt(): Promise<void>;
  /** Tenta mandar o que a fila guardou. Falha fica para a próxima. */
  drain(userId: string): Promise<void>;
  isActive(): boolean;
  subscribe(listener: () => void): () => void;
}

interface TrackingDeps {
  updates: LocationUpdates;
  window: TrackingWindowStore;
  drainer: Pick<PositionDrainer, 'drain'>;
  now(): Date;
  /** Falso na web: lá não há tarefa em segundo plano. */
  supported: boolean;
}

export function createPositionTracking(deps: TrackingDeps): PositionTracking {
  const { updates, window, drainer, now, supported } = deps;
  let active = false;
  const listeners = new Set<() => void>();

  const setActive = (next: boolean) => {
    if (active === next) return;
    active = next;
    listeners.forEach((listener) => listener());
  };

  async function stopUpdates(): Promise<void> {
    if (!supported) return;
    try {
      if (await updates.hasStarted()) await updates.stop();
    } catch {
      // A tarefa pode já não existir (app reinstalado, sistema a removeu).
    }
  }

  // Ligar e desligar entram numa fila, cada um começa quando o anterior
  // terminou. Sem ela, um desligar ainda em curso poderia terminar depois de
  // um ligar pedido em seguida e deixar a jornada aberta sem rastreio.
  let chain: Promise<unknown> = Promise.resolve();
  function queued<T>(operation: () => Promise<T>): Promise<T> {
    const run = chain.then(operation, operation);
    chain = run.catch(() => undefined);
    return run;
  }

  async function start(userId: string): Promise<StartResult> {
    let opened;
    try {
      opened = await window.open(userId, now());
    } catch {
      // Sem a janela no arquivo a tarefa não saberia de quem é o ponto.
      return 'failed';
    }
    if (!isWindowOpen(opened, now())) {
      await stopUpdates();
      setActive(false);
      return 'expired';
    }
    try {
      if (!(await updates.hasStarted())) await updates.start();
    } catch {
      setActive(false);
      return 'failed';
    }
    setActive(true);
    return 'tracking';
  }

  async function resume(userId: string): Promise<StartResult> {
    const current = await window.read();
    if (current?.userId !== userId || !isWindowOpen(current, now())) return 'skipped';
    try {
      if (!(await updates.hasStarted())) await updates.start();
    } catch {
      setActive(false);
      return 'failed';
    }
    setActive(true);
    return 'tracking';
  }

  async function stop(): Promise<void> {
    try {
      await window.close();
    } catch {
      // Desligar as leituras importa mais que o arquivo: segue.
    }
    await stopUpdates();
    setActive(false);
  }

  async function halt(): Promise<void> {
    await stopUpdates();
    setActive(false);
  }

  return {
    start: (userId) => (supported ? queued(() => start(userId)) : Promise.resolve('unsupported')),
    resume: (userId) => (supported ? queued(() => resume(userId)) : Promise.resolve('unsupported')),
    stop: () => queued(stop),
    halt: () => queued(halt),

    async drain(userId) {
      try {
        await drainer.drain(userId);
      } catch {
        // Os pontos seguem no arquivo.
      }
    },

    isActive: () => active,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Opções das leituras na jornada. Precisão alta; no iPhone sem pausa
 * automática, porque o iOS suspende as leituras de quem fica parado e não as
 * retoma sozinho, e um funcionário parado num posto é o caso comum. No
 * Android, serviço em primeiro plano com notificação fixa, que dispensa a
 * permissão "o tempo todo" e mantém o serviço com o app fora dos recentes.
 */
export const LOCATION_TASK_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  // Android: uma leitura a cada 10 s. A régua de 60 s ou 25 m vem depois.
  timeInterval: 10_000,
  distanceInterval: 0,
  // iPhone em segundo plano: junta as leituras e acorda a tarefa a cada 10 s.
  deferredUpdatesInterval: 10_000,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  activityType: Location.ActivityType.Other,
  foregroundService: {
    notificationTitle: 'Jornada em andamento',
    notificationBody: 'Sua localização está sendo enviada para a segurança da equipe.',
    killServiceOnDestroy: false,
  },
};

interface Runtime {
  outbox: PositionOutbox;
  window: TrackingWindowStore;
  drainer: PositionDrainer;
  tracking: PositionTracking;
}

let runtime: Runtime | null = null;

/**
 * As instâncias reais, uma por processo, criadas no primeiro uso: os arquivos
 * só são abertos quando alguém precisa deles, e a tarefa e as telas dividem
 * o mesmo dreno (um envio por vez).
 */
export function getPositionRuntime(): Runtime {
  if (runtime) return runtime;
  const outbox = createPositionOutbox(createFilePositionStorage());
  const window = createTrackingWindowStore(createFilePositionStorage(TRACKING_WINDOW_FILE_NAME));
  const drainer = createPositionDrainer({
    outbox,
    send: (points) => getPositionsBackend().sendBatch(points),
  });
  const tracking = createPositionTracking({
    updates: {
      start: () => Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, LOCATION_TASK_OPTIONS),
      stop: () => Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME),
      hasStarted: () => Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME),
    },
    window,
    drainer,
    now: () => new Date(),
    supported: Platform.OS !== 'web',
  });
  runtime = { outbox, window, drainer, tracking };
  return runtime;
}

/** Se o rastreio em segundo plano está ligado agora, reativo. */
export function useTrackingActive(): boolean {
  const { tracking } = getPositionRuntime();
  return useSyncExternalStore(tracking.subscribe, tracking.isActive, tracking.isActive);
}
