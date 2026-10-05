import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { SendQueueState } from '../outbox/sendQueue';
import { CONNECTION_GRACE_MS, connectionStatus } from './connectionStatus';
import { useConnectionLost, useOnReconnect } from './useConnection';

// Fila de mentira: daqui o hook só lê `stalled`.
const stateListeners = new Set<() => void>();
let mockState: SendQueueState = { items: [], refused: [], open: true, stalled: false };
const mockQueue = {
  getState: () => mockState,
  subscribe: (listener: () => void) => {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
};
jest.mock('../outbox/getSendQueue', () => ({ getSendQueue: () => mockQueue }));

// Dublê do socket do socket.io, registrado no armazém de verdade.
function fakeSocket() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(event: string, h: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(h);
    },
    off(event: string, h: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(h);
    },
    emit(event: string, ...args: unknown[]) {
      for (const h of [...(handlers.get(event) ?? [])]) h(...args);
    },
  };
}

let appStateHandler: ((status: AppStateStatus) => void) | null = null;
const removeAppState = jest.fn();
const unwatches: (() => void)[] = [];
const montadas: ReturnType<typeof create>[] = [];

function watched() {
  const socket = fakeSocket();
  unwatches.push(connectionStatus.watch(socket));
  socket.emit('connect');
  return socket;
}

function montar(elemento: React.ReactElement) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(elemento);
  });
  montadas.push(tree);
  return tree;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockState = { items: [], refused: [], open: true, stalled: false };
  appStateHandler = null;
  removeAppState.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (status: AppStateStatus) => void;
    return { remove: removeAppState } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  act(() => {
    for (const tree of montadas.splice(0)) tree.unmount();
    for (const unwatch of unwatches.splice(0)) unwatch();
    // O armazém é único no módulo: o teste seguinte começa sem pausa.
    connectionStatus.resume();
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('useConnectionLost', () => {
  function Leitor({ vistos }: { vistos: boolean[] }) {
    vistos.push(useConnectionLost());
    return null;
  }
  const ultimo = (vistos: boolean[]) => vistos[vistos.length - 1];

  it('com socket no ar e fila andando, há conexão', () => {
    const vistos: boolean[] = [];
    watched();
    montar(<Leitor vistos={vistos} />);
    expect(ultimo(vistos)).toBe(false);
  });

  it('socket caído além da carência é sem conexão, e a volta tira o aviso', () => {
    const vistos: boolean[] = [];
    const socket = watched();
    montar(<Leitor vistos={vistos} />);

    act(() => {
      socket.emit('disconnect', 'transport close');
      jest.advanceTimersByTime(CONNECTION_GRACE_MS);
    });
    expect(ultimo(vistos)).toBe(true);

    act(() => socket.emit('connect'));
    expect(ultimo(vistos)).toBe(false);
  });

  it('fila parada numa falha passageira é sem conexão, sem esperar carência', () => {
    const vistos: boolean[] = [];
    watched();
    montar(<Leitor vistos={vistos} />);

    act(() => {
      mockState = { ...mockState, stalled: true };
      for (const listener of stateListeners) listener();
    });
    expect(ultimo(vistos)).toBe(true);
  });

  it('no segundo plano a carência para, e na volta conta do zero', () => {
    const vistos: boolean[] = [];
    const socket = watched();
    montar(<Leitor vistos={vistos} />);

    act(() => {
      appStateHandler?.('background');
      socket.emit('disconnect', 'transport close');
      jest.advanceTimersByTime(60_000);
    });
    expect(ultimo(vistos)).toBe(false);

    act(() => {
      appStateHandler?.('active');
      jest.advanceTimersByTime(CONNECTION_GRACE_MS - 1);
    });
    expect(ultimo(vistos)).toBe(false);

    act(() => jest.advanceTimersByTime(1));
    expect(ultimo(vistos)).toBe(true);
  });

  it('o app inativo por um instante (central de controle) não pausa a carência', () => {
    const vistos: boolean[] = [];
    const socket = watched();
    montar(<Leitor vistos={vistos} />);

    act(() => {
      socket.emit('disconnect', 'transport close');
      appStateHandler?.('inactive');
      jest.advanceTimersByTime(CONNECTION_GRACE_MS);
    });
    expect(ultimo(vistos)).toBe(true);
  });

  // O iOS relança o app em segundo plano para o rastreio da jornada: a árvore
  // monta parada e nenhum evento de mudança chega.
  it('montado com o app já em segundo plano, a carência só corre na volta', () => {
    const estado = AppState as { currentState: unknown };
    const antes = estado.currentState;
    estado.currentState = 'background';
    try {
      const vistos: boolean[] = [];
      const socket = watched();
      montar(<Leitor vistos={vistos} />);

      act(() => {
        socket.emit('disconnect', 'transport close');
        jest.advanceTimersByTime(60_000);
      });
      expect(ultimo(vistos)).toBe(false);

      act(() => {
        appStateHandler?.('active');
        jest.advanceTimersByTime(CONNECTION_GRACE_MS);
      });
      expect(ultimo(vistos)).toBe(true);
    } finally {
      estado.currentState = antes;
    }
  });

  it('desmontar solta o ouvinte do AppState', () => {
    const tree = montar(<Leitor vistos={[]} />);
    act(() => tree.unmount());
    expect(removeAppState).toHaveBeenCalledTimes(1);
  });
});

describe('useOnReconnect', () => {
  function Ouvinte({ handler }: { handler: () => void }) {
    useOnReconnect(handler);
    return null;
  }

  it('chama o handler mais recente quando a conexão volta', () => {
    const primeiro = jest.fn();
    const segundo = jest.fn();
    const socket = watched();
    const tree = montar(<Ouvinte handler={primeiro} />);
    act(() => tree.update(<Ouvinte handler={segundo} />));

    act(() => {
      socket.emit('disconnect', 'transport close');
      socket.emit('connect');
    });

    expect(primeiro).not.toHaveBeenCalled();
    expect(segundo).toHaveBeenCalledTimes(1);
  });

  it('depois de desmontar não é mais chamado', () => {
    const handler = jest.fn();
    const socket = watched();
    const tree = montar(<Ouvinte handler={handler} />);
    act(() => tree.unmount());

    act(() => {
      socket.emit('disconnect', 'transport close');
      socket.emit('connect');
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
