import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';
import type { SendQueueEvent, SendQueueState } from './sendQueue';
import {
  SEND_RETRY_INTERVAL_MS,
  useSendQueueEvent,
  useSendQueueSession,
  useSendQueueState,
} from './useSendQueue';

// Fila de mentira com os mesmos verbos da real: o que se testa aqui é a ponte
// com o React (assinatura, relógio, primeiro plano), não a fila.
const stateListeners = new Set<() => void>();
const eventListeners = new Set<(event: SendQueueEvent) => void>();
let mockState: SendQueueState = { items: [], refused: [] };
const mockQueue = {
  start: jest.fn(async (_owner: string) => undefined),
  stop: jest.fn(),
  kick: jest.fn(async () => undefined),
  enqueue: jest.fn(),
  getState: () => mockState,
  subscribe: (listener: () => void) => {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
  onEvent: (listener: (event: SendQueueEvent) => void) => {
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  },
};
jest.mock('./getSendQueue', () => ({ getSendQueue: () => mockQueue }));

const mensagem = {
  id: 'i1',
  kind: 'chat.message' as const,
  createdAt: '2026-10-04T12:00:00.000Z',
  conversationId: 'a#b',
  body: 'oi',
  images: [],
};

let appStateHandler: ((status: AppStateStatus) => void) | null = null;
const removeAppState = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  stateListeners.clear();
  eventListeners.clear();
  mockState = { items: [], refused: [] };
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (status: AppStateStatus) => void;
    return { remove: removeAppState } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

// Toda árvore montada é desmontada ao fim do teste: a sessão liga um relógio
// de 15 s, e um relógio vivo segura o processo do jest aberto.
const montadas: ReturnType<typeof create>[] = [];
function montar(elemento: React.ReactElement) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(elemento);
  });
  montadas.push(tree);
  return tree;
}

afterEach(() => {
  act(() => {
    for (const tree of montadas.splice(0)) tree.unmount();
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('useSendQueueState', () => {
  it('entrega o estado da fila e acompanha as mudanças', () => {
    const vistos: number[] = [];
    function Tela() {
      vistos.push(useSendQueueState().items.length);
      return null;
    }
    const tree = montar(<Tela />);

    act(() => {
      mockState = { items: [mensagem], refused: [] };
      for (const listener of stateListeners) listener();
    });

    expect(vistos[0]).toBe(0);
    expect(vistos[vistos.length - 1]).toBe(1);

    act(() => tree.unmount());
    expect(stateListeners.size).toBe(0);
  });
});

describe('useSendQueueEvent', () => {
  it('entrega os eventos ao handler mais recente e solta a assinatura ao desmontar', () => {
    const primeiro = jest.fn();
    const segundo = jest.fn();
    function Tela({ handler }: { handler: (event: SendQueueEvent) => void }) {
      useSendQueueEvent(handler);
      return null;
    }
    const tree = montar(<Tela handler={primeiro} />);
    act(() => tree.update(<Tela handler={segundo} />));

    const evento: SendQueueEvent = { type: 'sent', item: mensagem, result: { id: 'm1' } };
    act(() => {
      for (const listener of eventListeners) listener(evento);
    });

    expect(primeiro).not.toHaveBeenCalled();
    expect(segundo).toHaveBeenCalledWith(evento);
    expect(eventListeners.size).toBe(1);

    act(() => tree.unmount());
    expect(eventListeners.size).toBe(0);
  });
});

describe('useSendQueueSession', () => {
  function Sessao({ userId }: { userId: string }) {
    useSendQueueSession(userId);
    return null;
  }

  it('abre a fila para quem está logado', () => {
    montar(<Sessao userId="u1" />);

    expect(mockQueue.start).toHaveBeenCalledWith('u1');
  });

  it('tenta enviar a cada 15 s', () => {
    jest.useFakeTimers();
    expect(SEND_RETRY_INTERVAL_MS).toBe(15_000);
    montar(<Sessao userId="u1" />);

    act(() => {
      jest.advanceTimersByTime(SEND_RETRY_INTERVAL_MS * 2);
    });

    expect(mockQueue.kick).toHaveBeenCalledTimes(2);
  });

  it('tenta enviar ao voltar ao primeiro plano, e só nessa hora', () => {
    montar(<Sessao userId="u1" />);

    appStateHandler?.('background');
    expect(mockQueue.kick).not.toHaveBeenCalled();

    appStateHandler?.('active');
    expect(mockQueue.kick).toHaveBeenCalledTimes(1);
  });

  it('ao sair, fecha a fila e para o relógio', () => {
    jest.useFakeTimers();
    const tree = montar(<Sessao userId="u1" />);

    act(() => tree.unmount());
    montadas.length = 0;
    act(() => {
      jest.advanceTimersByTime(SEND_RETRY_INTERVAL_MS * 2);
    });

    expect(mockQueue.stop).toHaveBeenCalledTimes(1);
    expect(removeAppState).toHaveBeenCalledTimes(1);
    expect(mockQueue.kick).not.toHaveBeenCalled();
  });

  it('trocou a pessoa: fecha a sessão anterior e abre a nova', () => {
    const tree = montar(<Sessao userId="u1" />);
    act(() => tree.update(<Sessao userId="u2" />));

    expect(mockQueue.stop).toHaveBeenCalledTimes(1);
    expect(mockQueue.start.mock.calls.map(([owner]) => owner)).toEqual(['u1', 'u2']);
  });

  it('falha ao abrir a fila não vira erro solto', async () => {
    mockQueue.start.mockRejectedValueOnce(new Error('disco'));

    montar(<Sessao userId="u1" />);
    await act(async () => {});

    expect(mockQueue.start).toHaveBeenCalledTimes(1);
  });
});
