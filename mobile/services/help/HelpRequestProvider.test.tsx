import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  HELP_REFRESH_MS,
  HELP_RETRY_MS,
  HelpRequestProvider,
  useHelpRequest,
  type HelpRequestState,
} from './HelpRequestProvider';
import type { HelpRequestChanged, HelpRequestView } from './types';

// O pedido de ajuda da sessão: um toque manda a posição e depois o pedido, com
// a mesma chave em toda tentativa até o servidor confirmar. Sem sinal, a falha
// aparece e o app tenta de novo sozinho; o estado segue o servidor pelo socket
// e por releitura enquanto o pedido está aberto.

let mockCoords: [number, number] | null = [-43.9, -19.9];
jest.mock('../location/LocationProvider', () => ({
  useLocation: () => ({ coords: mockCoords, permission: 'granted' }),
}));

const mockHeartbeat = jest.fn(async (_lat: number, _lng: number) => undefined);
jest.mock('../positions/getPositionsBackend', () => ({
  getPositionsBackend: () => ({ heartbeat: mockHeartbeat }),
}));

let mockOnChanged: ((c: HelpRequestChanged) => void) | null = null;
const mockUnsubscribe = jest.fn();
const mockBackend = {
  request: jest.fn(async (_key: string): Promise<HelpRequestView> => ABERTO),
  mine: jest.fn(async (): Promise<HelpRequestView | null> => null),
  subscribe: jest.fn((cb: (c: HelpRequestChanged) => void) => {
    mockOnChanged = cb;
    return mockUnsubscribe;
  }),
};
jest.mock('./getHelpRequestBackend', () => ({ getHelpRequestBackend: () => mockBackend }));

const ABERTO: HelpRequestView = {
  id: 'h1',
  status: 'OPEN',
  createdAt: '2026-10-22T12:00:00.000Z',
  attendedAt: null,
  closedAt: null,
  rescue: null,
};

const DESPACHADO: HelpRequestView = {
  ...ABERTO,
  status: 'ATTENDED',
  attendedAt: '2026-10-22T12:01:00.000Z',
  rescue: {
    id: 'r1',
    status: 'dispatched',
    dispatchedAt: '2026-10-22T12:01:00.000Z',
    arrivedAt: null,
    rescuerPosition: { lat: -19.9, lng: -43.89, recordedAt: '2026-10-22T12:01:00.000Z' },
  },
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const semRede = () => Object.assign(new Error('Tempo esgotado.'), { code: 'TIMEOUT' });
const recusado = (status: number) => Object.assign(new Error('Proibido'), { status });

let estado: HelpRequestState;
function Sonda() {
  estado = useHelpRequest();
  return null;
}

let tree: ReactTestRenderer | null = null;
const montar = async () => {
  await act(async () => {
    tree = create(
      <HelpRequestProvider>
        <Sonda />
      </HelpRequestProvider>,
    );
  });
};

const pedir = async () => {
  await act(async () => {
    estado.requestHelp();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCoords = [-43.9, -19.9];
  mockOnChanged = null;
  mockBackend.mine.mockResolvedValue(null);
  mockBackend.request.mockResolvedValue(ABERTO);
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = null;
  jest.useRealTimers();
});

describe('HelpRequestProvider, leitura', () => {
  it('lê o pedido mais recente ao montar', async () => {
    mockBackend.mine.mockResolvedValue(ABERTO);

    await montar();

    expect(estado.helpRequest).toEqual(ABERTO);
    expect(estado.sending).toBe(false);
    expect(estado.failed).toBe(false);
  });

  it('nunca pediu: sem pedido, sem tempo e sem socket', async () => {
    await montar();

    expect(estado.helpRequest).toBeNull();
    expect(estado.rescuerEtaMin).toBeNull();
    expect(mockBackend.subscribe).not.toHaveBeenCalled();
  });

  it('falha na leitura não derruba nada', async () => {
    mockBackend.mine.mockRejectedValue(semRede());

    await montar();

    expect(estado.helpRequest).toBeNull();
    expect(estado.failed).toBe(false);
  });

  it('fora do provider é erro, nunca um pedido que não sai', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => act(() => { create(<Sonda />); })).toThrow(/HelpRequestProvider/);
    spy.mockRestore();
  });
});

describe('HelpRequestProvider, pedir ajuda', () => {
  it('manda a posição (lat, lng) antes do pedido, com chave UUID v4', async () => {
    await montar();

    await pedir();

    expect(mockHeartbeat).toHaveBeenCalledWith(-19.9, -43.9);
    const [chave] = mockBackend.request.mock.calls[0];
    expect(chave).toMatch(UUID_V4);
    expect(mockHeartbeat.mock.invocationCallOrder[0]).toBeLessThan(
      mockBackend.request.mock.invocationCallOrder[0],
    );
    expect(estado.helpRequest).toEqual(ABERTO);
    expect(estado.sending).toBe(false);
  });

  it('sem posição do GPS o pedido sai mesmo assim', async () => {
    mockCoords = null;
    await montar();

    await pedir();

    expect(mockHeartbeat).not.toHaveBeenCalled();
    expect(mockBackend.request).toHaveBeenCalledTimes(1);
  });

  it('a posição que não sobe não segura o pedido', async () => {
    mockHeartbeat.mockRejectedValueOnce(semRede());
    await montar();

    await pedir();

    expect(mockBackend.request).toHaveBeenCalledTimes(1);
    expect(estado.helpRequest).toEqual(ABERTO);
  });

  it('dois toques seguidos fazem um pedido só', async () => {
    let soltar!: (v: HelpRequestView) => void;
    mockBackend.request.mockImplementationOnce(
      () => new Promise<HelpRequestView>((r) => { soltar = r; }),
    );
    await montar();

    await act(async () => {
      estado.requestHelp();
      estado.requestHelp();
    });
    expect(estado.sending).toBe(true);
    await act(async () => { soltar(ABERTO); });

    expect(mockBackend.request).toHaveBeenCalledTimes(1);
    expect(estado.sending).toBe(false);
  });

  it('cada pedido confirmado libera uma chave nova para o próximo toque', async () => {
    await montar();

    await pedir();
    await pedir();

    const [[a], [b]] = mockBackend.request.mock.calls;
    expect(a).not.toBe(b);
  });
});

describe('HelpRequestProvider, sem sinal', () => {
  it('a falha aparece e tentar de novo repete a MESMA chave', async () => {
    mockBackend.request.mockRejectedValueOnce(semRede());
    await montar();

    await pedir();
    expect(estado.failed).toBe(true);
    expect(estado.helpRequest).toBeNull();

    await pedir();

    const [[primeira], [segunda]] = mockBackend.request.mock.calls;
    expect(segunda).toBe(primeira);
    expect(estado.failed).toBe(false);
    expect(estado.helpRequest).toEqual(ABERTO);
  });

  it('o app tenta de novo sozinho, com a mesma chave, até o servidor confirmar', async () => {
    jest.useFakeTimers();
    mockBackend.request.mockRejectedValueOnce(semRede()).mockRejectedValueOnce(semRede());
    await montar();

    await pedir();
    expect(mockBackend.request).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(HELP_RETRY_MS); });
    expect(mockBackend.request).toHaveBeenCalledTimes(2);
    expect(estado.failed).toBe(true);

    await act(async () => { jest.advanceTimersByTime(HELP_RETRY_MS); });
    expect(mockBackend.request).toHaveBeenCalledTimes(3);
    expect(new Set(mockBackend.request.mock.calls.map(([k]) => k)).size).toBe(1);
    expect(estado.failed).toBe(false);
    expect(estado.helpRequest).toEqual(ABERTO);

    await act(async () => { jest.advanceTimersByTime(HELP_RETRY_MS * 3); });
    expect(mockBackend.request).toHaveBeenCalledTimes(3);
  });

  it('servidor fora do ar (5xx) também tenta de novo sozinho', async () => {
    jest.useFakeTimers();
    mockBackend.request.mockRejectedValueOnce(recusado(503));
    await montar();

    await pedir();
    await act(async () => { jest.advanceTimersByTime(HELP_RETRY_MS); });

    expect(mockBackend.request).toHaveBeenCalledTimes(2);
  });

  // Recusa de verdade (sem permissão, chave inválida) não melhora repetindo:
  // a falha fica na tela e só o toque tenta de novo.
  it('recusa do servidor (4xx) não repete sozinha', async () => {
    jest.useFakeTimers();
    mockBackend.request.mockRejectedValue(recusado(403));
    await montar();

    await pedir();
    await act(async () => { jest.advanceTimersByTime(HELP_RETRY_MS * 4); });

    expect(mockBackend.request).toHaveBeenCalledTimes(1);
    expect(estado.failed).toBe(true);
  });

  it('sair da sessão para a nova tentativa', async () => {
    jest.useFakeTimers();
    mockBackend.request.mockRejectedValue(semRede());
    await montar();
    await pedir();

    act(() => tree?.unmount());
    tree = null;
    await act(async () => { jest.advanceTimersByTime(HELP_RETRY_MS * 2); });

    expect(mockBackend.request).toHaveBeenCalledTimes(1);
  });
});

describe('HelpRequestProvider, acompanhar o pedido', () => {
  it('pedido aberto: o aviso do socket relê o pedido', async () => {
    mockBackend.mine.mockResolvedValueOnce(ABERTO).mockResolvedValueOnce(DESPACHADO);
    await montar();
    expect(mockBackend.subscribe).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockOnChanged?.({ workerId: 'w1', helpRequestId: 'h1', status: 'ATTENDED', at: 'x' });
    });

    expect(mockBackend.mine).toHaveBeenCalledTimes(2);
    expect(estado.helpRequest).toEqual(DESPACHADO);
  });

  it('relê em cadência enquanto aberto, para a posição do socorrista andar', async () => {
    jest.useFakeTimers();
    mockBackend.mine.mockResolvedValue(DESPACHADO);
    await montar();

    await act(async () => { jest.advanceTimersByTime(HELP_REFRESH_MS); });

    expect(mockBackend.mine).toHaveBeenCalledTimes(2);
  });

  it('pedido encerrado larga o socket e a releitura', async () => {
    jest.useFakeTimers();
    mockBackend.mine
      .mockResolvedValueOnce(ABERTO)
      .mockResolvedValue({ ...ABERTO, status: 'CLOSED', closedAt: '2026-10-22T13:00:00.000Z' });
    await montar();

    await act(async () => {
      mockOnChanged?.({ workerId: 'w1', helpRequestId: 'h1', status: 'CLOSED', at: 'x' });
    });
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    const leituras = mockBackend.mine.mock.calls.length;

    await act(async () => { jest.advanceTimersByTime(HELP_REFRESH_MS * 2); });
    expect(mockBackend.mine).toHaveBeenCalledTimes(leituras);
  });

  it('o pedido confirmado passa a ser acompanhado', async () => {
    await montar();
    expect(mockBackend.subscribe).not.toHaveBeenCalled();

    await pedir();

    expect(mockBackend.subscribe).toHaveBeenCalledTimes(1);
  });

  it('socorrista despachado: tempo até o funcionário', async () => {
    mockBackend.mine.mockResolvedValue(DESPACHADO);

    await montar();

    // 0,01 grau de longitude a ~20 graus de latitude, a pé.
    expect(estado.rescuerEtaMin).toBe(12);
  });
});
