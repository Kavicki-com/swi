import { createElement, type ComponentType } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useJourneyTracking, useTrackingSession } from './useTrackingLifecycle';
import type { PositionTracking, StartResult } from './positionTracking';
import type { JourneyState } from '../journey/types';

const TestRenderer: {
  create: (el: unknown) => { update: (el: unknown) => void; unmount: () => void };
  act: (cb: () => void | Promise<void>) => void | Promise<void>;
} = require('react-test-renderer');
const act = TestRenderer.act;

function fakeTracking(): jest.Mocked<PositionTracking> {
  return {
    start: jest.fn(async (_userId: string): Promise<StartResult> => 'tracking'),
    stop: jest.fn(async () => undefined),
    halt: jest.fn(async () => undefined),
    drain: jest.fn(async (_userId: string) => undefined),
    isActive: jest.fn(() => false),
    subscribe: jest.fn((_listener: () => void) => () => undefined),
  };
}

// O AppState de verdade não muda sob a suíte: o ouvinte é capturado e chamado
// à mão. Cada hook montado registra o seu.
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
afterEach(() => jest.restoreAllMocks());

interface JourneyProps {
  userId: string | null;
  journeyState: JourneyState;
  journeyKnown: boolean;
  tracking: PositionTracking;
}
function JourneyHarness({ userId, journeyState, journeyKnown, tracking }: JourneyProps) {
  useJourneyTracking(userId, journeyState, journeyKnown, tracking);
  return null;
}
const journey = (props: JourneyProps) => createElement(JourneyHarness as ComponentType<any>, props);

interface SessionProps {
  userId: string | null;
  restoring?: boolean;
  tracking: PositionTracking;
  tokenExists?: () => Promise<boolean>;
}
function SessionHarness({ userId, restoring = false, tracking, tokenExists }: SessionProps) {
  useTrackingSession(userId, restoring, tracking, tokenExists ?? semToken);
  return null;
}
const semToken = async () => false;
const comToken = async () => true;
const session = (props: SessionProps) => createElement(SessionHarness as ComponentType<any>, props);

describe('useJourneyTracking', () => {
  it('jornada em andamento ou pausada liga o rastreio da pessoa', async () => {
    for (const journeyState of ['ongoing', 'paused'] as const) {
      const tracking = fakeTracking();
      await act(async () => {
        TestRenderer.create(journey({ userId: 'u1', journeyState, journeyKnown: true, tracking }));
      });
      expect(tracking.start).toHaveBeenCalledWith('u1');
      expect(tracking.stop).not.toHaveBeenCalled();
    }
  });

  it('jornada encerrada (ociosa) desliga', async () => {
    const tracking = fakeTracking();
    let root!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      root = TestRenderer.create(journey({ userId: 'u1', journeyState: 'ongoing', journeyKnown: true, tracking }));
    });
    await act(async () => {
      root.update(journey({ userId: 'u1', journeyState: 'idle', journeyKnown: true, tracking }));
    });
    expect(tracking.stop).toHaveBeenCalledTimes(1);
  });

  it('antes de a jornada carregar, não decide nada', async () => {
    const tracking = fakeTracking();
    await act(async () => {
      TestRenderer.create(journey({ userId: 'u1', journeyState: 'idle', journeyKnown: false, tracking }));
    });
    expect(tracking.start).not.toHaveBeenCalled();
    expect(tracking.stop).not.toHaveBeenCalled();
  });

  it('sem sessão, não decide nada', async () => {
    const tracking = fakeTracking();
    await act(async () => {
      TestRenderer.create(journey({ userId: null, journeyState: 'ongoing', journeyKnown: true, tracking }));
    });
    expect(tracking.start).not.toHaveBeenCalled();
  });

  it('pausar e retomar não repete o pedido a cada render igual', async () => {
    const tracking = fakeTracking();
    let root!: ReturnType<typeof TestRenderer.create>;
    const props = { userId: 'u1', journeyState: 'ongoing' as const, journeyKnown: true, tracking };
    await act(async () => {
      root = TestRenderer.create(journey(props));
    });
    await act(async () => {
      root.update(journey({ ...props }));
    });
    expect(tracking.start).toHaveBeenCalledTimes(1);
  });

  // Quem negou a localização e liberou depois nos ajustes volta ao app pelo
  // primeiro plano: é a hora de tentar ligar de novo.
  it('com a jornada ativa, cada volta ao primeiro plano tenta ligar de novo', async () => {
    const tracking = fakeTracking();
    await act(async () => {
      TestRenderer.create(journey({ userId: 'u1', journeyState: 'ongoing', journeyKnown: true, tracking }));
    });
    await appState('background');
    expect(tracking.start).toHaveBeenCalledTimes(1);
    await appState('active');
    expect(tracking.start).toHaveBeenCalledTimes(2);
  });

  it('com a jornada ociosa, a volta ao primeiro plano não liga nada', async () => {
    const tracking = fakeTracking();
    await act(async () => {
      TestRenderer.create(journey({ userId: 'u1', journeyState: 'idle', journeyKnown: true, tracking }));
    });
    await appState('active');
    expect(tracking.start).not.toHaveBeenCalled();
  });

  it('desmontar (logout) não desliga por conta própria: quem desliga é a sessão', async () => {
    const tracking = fakeTracking();
    let root!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      root = TestRenderer.create(journey({ userId: 'u1', journeyState: 'ongoing', journeyKnown: true, tracking }));
    });
    await act(async () => root.unmount());
    expect(tracking.stop).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });
});

describe('useTrackingSession', () => {
  it('com sessão, tenta reenviar ao montar e a cada volta ao primeiro plano', async () => {
    const tracking = fakeTracking();
    await act(async () => {
      TestRenderer.create(session({ userId: 'u1', tracking }));
    });
    expect(tracking.drain).toHaveBeenCalledWith('u1');
    await appState('background');
    expect(tracking.drain).toHaveBeenCalledTimes(1);
    await appState('active');
    expect(tracking.drain).toHaveBeenCalledTimes(2);
    expect(tracking.stop).not.toHaveBeenCalled();
  });

  it('sem sessão, não reenvia nem escuta', async () => {
    const tracking = fakeTracking();
    await act(async () => {
      TestRenderer.create(session({ userId: null, tracking, tokenExists: comToken }));
    });
    expect(tracking.drain).not.toHaveBeenCalled();
    expect(listeners).toHaveLength(0);
  });

  it('logout (sessão some) desliga o rastreio e solta o ouvinte', async () => {
    const tracking = fakeTracking();
    let root!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      root = TestRenderer.create(session({ userId: 'u1', tracking }));
    });
    await act(async () => {
      root.update(session({ userId: null, tracking, tokenExists: comToken }));
    });
    expect(tracking.stop).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalled();
  });

  // Token expirado ou conta desativada: o app abre sem usuário e o token já
  // foi apagado. O rastreio de antes não pode seguir gravando.
  it('app aberto sem sessão e sem token guardado desliga o rastreio', async () => {
    const tracking = fakeTracking();
    await act(async () => {
      TestRenderer.create(session({ userId: null, tracking, tokenExists: semToken }));
    });
    expect(tracking.stop).toHaveBeenCalledTimes(1);
  });

  // Sem rede a sessão não é confirmada e o app abre sem usuário, mas o token
  // segue guardado: a jornada pode estar em andamento, e o rastreio fica.
  it('app aberto sem sessão mas com token guardado não desliga', async () => {
    const tracking = fakeTracking();
    await act(async () => {
      TestRenderer.create(session({ userId: null, tracking, tokenExists: comToken }));
    });
    expect(tracking.stop).not.toHaveBeenCalled();
  });

  it('enquanto a sessão restaura, não decide nada', async () => {
    const tracking = fakeTracking();
    const tokenExists = jest.fn(semToken);
    await act(async () => {
      TestRenderer.create(session({ userId: null, restoring: true, tracking, tokenExists }));
    });
    expect(tokenExists).not.toHaveBeenCalled();
    expect(tracking.stop).not.toHaveBeenCalled();
  });

  it('falha ao ler o token não desliga', async () => {
    const tracking = fakeTracking();
    const tokenExists = async () => {
      throw new Error('keychain');
    };
    await act(async () => {
      TestRenderer.create(session({ userId: null, tracking, tokenExists }));
    });
    expect(tracking.stop).not.toHaveBeenCalled();
  });
});
