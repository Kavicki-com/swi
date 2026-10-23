import { createElement, type ComponentType } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  EVACUATION_POLL_MS,
  latestEvacuationNotice,
  useEvacuationTracking,
  type EvacuationTrackingDeps,
} from './useEvacuationTracking';
import type { PositionTracking, StartResult } from './positionTracking';
import type { ActiveEvacuationView } from '../evacuation/types';
import type { TrackingPermission } from './trackingPermission';
import type { NotificationDomain } from '../notifications/types';

const TestRenderer: {
  create: (el: unknown) => { update: (el: unknown) => void; unmount: () => void };
  act: (cb: () => void | Promise<void>) => void | Promise<void>;
} = require('react-test-renderer');
const act = TestRenderer.act;

function fakeTracking(): jest.Mocked<PositionTracking> {
  return {
    start: jest.fn(async (_userId: string): Promise<StartResult> => 'tracking'),
    resume: jest.fn(async (_userId: string): Promise<StartResult> => 'tracking'),
    stop: jest.fn(async () => undefined),
    stopJourney: jest.fn(async () => undefined),
    startEvacuation: jest.fn(async (_userId: string, _evacuationId: string): Promise<StartResult> => 'tracking'),
    endEvacuation: jest.fn(async () => undefined),
    halt: jest.fn(async () => undefined),
    drain: jest.fn(async (_userId: string) => undefined),
    isActive: jest.fn(() => false),
    subscribe: jest.fn((_listener: () => void) => () => undefined),
  };
}

const ativa = (id = 'e1'): ActiveEvacuationView => ({ id, total: 3, ackedCount: 0, myAck: false });

interface FakeOpts {
  active?: ActiveEvacuationView | null;
  offline?: boolean;
  permission?: TrackingPermission;
}

function fakeDeps(opts: FakeOpts = {}) {
  let foreground = true;
  const deps = {
    tracking: fakeTracking(),
    getActive: jest.fn(async (): Promise<ActiveEvacuationView | null> => {
      if (opts.offline) throw new Error('rede');
      return opts.active === undefined ? ativa() : opts.active;
    }),
    askPermission: jest.fn(async (): Promise<TrackingPermission> => opts.permission ?? 'granted'),
    askAlways: jest.fn(async () => undefined),
    isForeground: () => foreground,
  };
  return {
    deps,
    setForeground: (next: boolean) => {
      foreground = next;
    },
  };
}

// O AppState de verdade não muda sob a suíte: o ouvinte é capturado e chamado
// à mão, como na suíte do useTrackingLifecycle.
let listeners: ((state: AppStateStatus) => void)[];
const remove = jest.fn();
const appState = async (state: AppStateStatus) => {
  await act(async () => listeners.forEach((listener) => listener(state)));
};
beforeEach(() => {
  listeners = [];
  remove.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    listeners.push(cb as (state: AppStateStatus) => void);
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});
// Toda árvore montada desmonta ao fim do teste: a consulta periódica da
// evacuação ativa seguiria viva e seguraria o jest depois da suíte.
let montadas: { unmount: () => void }[] = [];
afterEach(async () => {
  for (const root of montadas) await act(async () => root.unmount());
  montadas = [];
  jest.restoreAllMocks();
  jest.useRealTimers();
});

interface Props {
  userId: string | null;
  notice: string | null;
  deps: EvacuationTrackingDeps;
}
function Harness({ userId, notice, deps }: Props) {
  useEvacuationTracking(userId, notice, deps);
  return null;
}
const harness = (props: Props) => createElement(Harness as ComponentType<any>, props);

async function montar(props: Props) {
  let root!: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    root = TestRenderer.create(harness(props));
  });
  montadas.push(root);
  return root;
}

describe('useEvacuationTracking', () => {
  it('sem sessão, não consulta nada', async () => {
    const { deps } = fakeDeps();
    await montar({ userId: null, notice: null, deps });
    expect(deps.getActive).not.toHaveBeenCalled();
  });

  it('com evacuação ativa e o app na frente, pede a permissão e liga o rastreio da evacuação', async () => {
    const { deps } = fakeDeps();
    await montar({ userId: 'u1', notice: null, deps });
    expect(deps.askPermission).toHaveBeenCalledTimes(1);
    expect(deps.tracking.startEvacuation).toHaveBeenCalledWith('u1', 'e1');
    // O "Sempre" do iPhone vem depois, com o rastreio já ligado.
    expect(deps.askAlways).toHaveBeenCalledTimes(1);
  });

  it('sem evacuação ativa, encerra a da evacuação e não pede nada', async () => {
    const { deps } = fakeDeps({ active: null });
    await montar({ userId: 'u1', notice: null, deps });
    expect(deps.tracking.endEvacuation).toHaveBeenCalledTimes(1);
    expect(deps.askPermission).not.toHaveBeenCalled();
    expect(deps.tracking.startEvacuation).not.toHaveBeenCalled();
  });

  it('sem rede, não liga nem desliga', async () => {
    const { deps } = fakeDeps({ offline: true });
    await montar({ userId: 'u1', notice: null, deps });
    expect(deps.tracking.startEvacuation).not.toHaveBeenCalled();
    expect(deps.tracking.endEvacuation).not.toHaveBeenCalled();
  });

  it('a mesma evacuação vista de novo não pede outra vez nem religa', async () => {
    const { deps } = fakeDeps();
    const root = await montar({ userId: 'u1', notice: null, deps });
    await act(async () => root.update(harness({ userId: 'u1', notice: 'n1', deps })));
    await appState('active');
    expect(deps.getActive).toHaveBeenCalledTimes(3);
    expect(deps.askPermission).toHaveBeenCalledTimes(1);
    expect(deps.tracking.startEvacuation).toHaveBeenCalledTimes(1);
  });

  it('a notificação de evacuação que chega faz consultar de novo', async () => {
    const { deps } = fakeDeps({ active: null });
    const root = await montar({ userId: 'u1', notice: null, deps });
    deps.getActive.mockResolvedValueOnce(ativa());
    await act(async () => root.update(harness({ userId: 'u1', notice: 'n1', deps })));
    expect(deps.tracking.startEvacuation).toHaveBeenCalledWith('u1', 'e1');
  });

  it('com o app em segundo plano, não pede permissão nem liga; liga na volta à frente', async () => {
    const { deps, setForeground } = fakeDeps();
    setForeground(false);
    await montar({ userId: 'u1', notice: null, deps });
    expect(deps.askPermission).not.toHaveBeenCalled();
    expect(deps.tracking.startEvacuation).not.toHaveBeenCalled();

    setForeground(true);
    await appState('active');
    expect(deps.askPermission).toHaveBeenCalledTimes(1);
    expect(deps.tracking.startEvacuation).toHaveBeenCalledWith('u1', 'e1');
  });

  // Quem nega pode liberar nos ajustes e voltar ao app: a volta tenta ligar
  // de novo, sem repetir o pedido que o sistema já não mostra.
  it('permissão negada: tenta ligar, e a volta à frente tenta de novo sem pedir outra vez', async () => {
    const { deps } = fakeDeps({ permission: 'denied' });
    deps.tracking.startEvacuation.mockResolvedValueOnce('failed');
    await montar({ userId: 'u1', notice: null, deps });
    expect(deps.tracking.startEvacuation).toHaveBeenCalledTimes(1);
    expect(deps.askAlways).not.toHaveBeenCalled();

    await appState('active');
    expect(deps.askPermission).toHaveBeenCalledTimes(1);
    expect(deps.tracking.startEvacuation).toHaveBeenCalledTimes(2);
  });

  it('durante a evacuação, consulta de tempos em tempos e encerra quando o gestor encerra', async () => {
    jest.useFakeTimers();
    const { deps } = fakeDeps();
    await montar({ userId: 'u1', notice: null, deps });
    expect(deps.getActive).toHaveBeenCalledTimes(1);

    deps.getActive.mockResolvedValue(null);
    await act(async () => {
      jest.advanceTimersByTime(EVACUATION_POLL_MS);
    });
    expect(deps.getActive).toHaveBeenCalledTimes(2);
    expect(deps.tracking.endEvacuation).toHaveBeenCalledTimes(1);

    // Sem evacuação, a consulta periódica para.
    await act(async () => {
      jest.advanceTimersByTime(EVACUATION_POLL_MS * 3);
    });
    expect(deps.getActive).toHaveBeenCalledTimes(2);
  });

  it('sem evacuação, não consulta de tempos em tempos', async () => {
    jest.useFakeTimers();
    const { deps } = fakeDeps({ active: null });
    await montar({ userId: 'u1', notice: null, deps });
    await act(async () => {
      jest.advanceTimersByTime(EVACUATION_POLL_MS * 3);
    });
    expect(deps.getActive).toHaveBeenCalledTimes(1);
  });

  it('desmontar solta o ouvinte e para a consulta', async () => {
    jest.useFakeTimers();
    const { deps } = fakeDeps();
    const root = await montar({ userId: 'u1', notice: null, deps });
    await act(async () => root.unmount());
    await act(async () => {
      jest.advanceTimersByTime(EVACUATION_POLL_MS * 2);
    });
    expect(remove).toHaveBeenCalled();
    expect(deps.getActive).toHaveBeenCalledTimes(1);
  });
});

describe('latestEvacuationNotice', () => {
  const n = (id: string, domain: NotificationDomain, hora: string) => ({
    id,
    domain,
    createdAt: `2026-10-04T${hora}:00.000Z`,
  });

  it('sem notificação de evacuação, null', () => {
    expect(latestEvacuationNotice([])).toBeNull();
    expect(latestEvacuationNotice([n('a', 'chat', '10:00')])).toBeNull();
  });

  it('a de evacuação mais recente, em qualquer ordem', () => {
    expect(
      latestEvacuationNotice([n('a', 'evacuation', '09:00'), n('b', 'chat', '12:00'), n('c', 'evacuation', '11:00')]),
    ).toBe('c');
  });
});
