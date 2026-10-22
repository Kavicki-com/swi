import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EvacuationProvider } from './EvacuationProvider';
import { useEvacuationRoute } from './useEvacuationRoute';
import type { RouteSnapshot } from './types';

// A rota de evacuacao e tela de seguranca: ela tem que sair de onde a pessoa
// esta e ser refeita quando a pessoa sai do caminho. O que este teste trava:
//
// 1. A primeira busca leva o GPS; com a permissao negada leva null (o backend
//    cai na ultima posicao real gravada) e sem resposta do GPS ainda nao
//    chama ninguem.
// 2. O recalculo tem dois freios: 50 m de distancia do tracado e 15 s entre
//    chamadas. Sem os dois, o app bate no backend a cada passo.
// 3. O motivo do erro vem do status HTTP, porque cada um tem uma frase
//    diferente na tela (sem evacuacao, sem posicao, falhou).

let mockCoords: [number, number] | null = null;
let mockPermission = 'granted';
jest.mock('@/services/location/LocationProvider', () => ({
  useLocation: () => ({ coords: mockCoords, permission: mockPermission }),
}));

// useFocusEffect roda o callback na montagem, como no foco real da rota, e
// guarda os callbacks pra o teste simular a pessoa voltando pra tela.
const mockFocusCallbacks = new Set<() => void>();
const mockRefocus = () => mockFocusCallbacks.forEach((cb) => cb());
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    useEffect(() => {
      mockFocusCallbacks.add(cb);
      cb();
      return () => { mockFocusCallbacks.delete(cb); };
    }, [cb]);
  },
}));

const mockGetRoute = jest.fn();
jest.mock('./getEvacuationBackend', () => ({
  getEvacuationBackend: () => ({
    getRoute: (from: [number, number] | null) => mockGetRoute(from),
    getActive: jest.fn(),
    ack: jest.fn(),
  }),
}));

// Linha reta ao longo do paralelo -23,55: a distancia ate ela e so a diferenca
// de latitude, conferivel de cabeca (0,0009 grau = ~100 m).
const NA_LINHA: [number, number] = [-46.625, -23.55];
const A_30_M: [number, number] = [-46.625, -23.55 + 0.00027];
const A_80_M: [number, number] = [-46.625, -23.55 + 0.00072];
const OUTRO_80_M: [number, number] = [-46.6255, -23.55 + 0.00072];

const rota = (over: Partial<RouteSnapshot> = {}): RouteSnapshot => ({
  waypoints: [[-46.63, -23.55], [-46.62, -23.55]],
  durationSec: 600,
  distanceM: 1000,
  fetchedAt: '2026-10-21T12:00:00.000Z',
  origin: [-46.63, -23.55],
  destination: [-46.62, -23.55],
  approximate: false,
  ...over,
});

let visto: ReturnType<typeof useEvacuationRoute>;
function Harness() {
  visto = useEvacuationRoute();
  return null;
}
// Segunda tela com o mesmo hook: a tela inicial fica montada embaixo da tela
// em andamento na pilha do expo-router, entao as duas vivem juntas.
function OutraTela() {
  useEvacuationRoute();
  return null;
}

const montar = async (): Promise<ReactTestRenderer> => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      createElement(EvacuationProvider, null, createElement(Harness)),
    );
  });
  return tree;
};

// Rerender com o MESMO elemento: o provider nao remonta, so reage ao novo GPS.
const mover = async (tree: ReactTestRenderer, to: [number, number] | null) => {
  mockCoords = to;
  await act(async () => {
    tree.update(createElement(EvacuationProvider, null, createElement(Harness)));
  });
};

const erro = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallbacks.clear();
  jest.useFakeTimers();
  mockCoords = null;
  mockPermission = 'granted';
  mockGetRoute.mockResolvedValue(rota());
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useEvacuationRoute: primeira busca', () => {
  it('sem posicao e sem resposta do GPS ainda nao busca nada', async () => {
    await montar();
    expect(mockGetRoute).not.toHaveBeenCalled();
    expect(visto.loadStatus).toBe('idle');
  });

  it('busca com a posicao do GPS quando o fix chega', async () => {
    const tree = await montar();
    await mover(tree, NA_LINHA);

    expect(mockGetRoute).toHaveBeenCalledTimes(1);
    expect(mockGetRoute).toHaveBeenCalledWith(NA_LINHA);
    expect(visto.loadStatus).toBe('ready');
    expect(visto.route?.destination).toEqual([-46.62, -23.55]);
    expect(visto.coords).toEqual(NA_LINHA);
  });

  it('com a localizacao negada busca sem posicao, deixando o backend usar a ultima real', async () => {
    mockPermission = 'denied';
    await montar();

    expect(mockGetRoute).toHaveBeenCalledWith(null);
  });

  it('busca uma vez so, mesmo com o GPS mandando fix atras de fix', async () => {
    const tree = await montar();
    await mover(tree, NA_LINHA);
    await mover(tree, [-46.6251, -23.55]);

    expect(mockGetRoute).toHaveBeenCalledTimes(1);
  });
});

describe('useEvacuationRoute: volta pra tela', () => {
  // Visto no emulador: com a evacuacao encerrada, voltar pra tela mostrava a
  // rota antiga, porque a busca acontecia uma vez por sessao do app. Cada vez
  // que a tela ganha foco a rota e buscada de novo.
  it('ao voltar o foco busca de novo, e a evacuacao encerrada vira a frase', async () => {
    const tree = await montar();
    await mover(tree, NA_LINHA);
    expect(mockGetRoute).toHaveBeenCalledTimes(1);
    expect(visto.route).not.toBeNull();

    mockGetRoute.mockRejectedValueOnce(erro(404));
    await act(async () => { mockRefocus(); });

    expect(mockGetRoute).toHaveBeenCalledTimes(2);
    expect(mockGetRoute).toHaveBeenLastCalledWith(NA_LINHA);
    expect(visto.route).toBeNull();
    expect(visto.errorKind).toBe('no-evacuation');
  });
});

describe('useEvacuationRoute: recalculo', () => {
  const comRota = async () => {
    const tree = await montar();
    await mover(tree, NA_LINHA);
    await act(async () => { jest.advanceTimersByTime(16_000); });
    return tree;
  };

  it('a 30 m do tracado nao recalcula: desvio de calcada nao e sair da rota', async () => {
    const tree = await comRota();
    await mover(tree, A_30_M);

    expect(mockGetRoute).toHaveBeenCalledTimes(1);
  });

  it('a 80 m do tracado recalcula a partir da posicao nova', async () => {
    const tree = await comRota();
    await mover(tree, A_80_M);

    expect(mockGetRoute).toHaveBeenCalledTimes(2);
    expect(mockGetRoute).toHaveBeenLastCalledWith(A_80_M);
  });

  it('longe do tracado de novo antes de 15 s nao recalcula; depois de 15 s sim', async () => {
    const tree = await comRota();
    await mover(tree, A_80_M);
    expect(mockGetRoute).toHaveBeenCalledTimes(2);

    await mover(tree, OUTRO_80_M);
    expect(mockGetRoute).toHaveBeenCalledTimes(2);

    await act(async () => { jest.advanceTimersByTime(16_000); });
    await mover(tree, A_80_M);
    expect(mockGetRoute).toHaveBeenCalledTimes(3);
  });

  it('o recalculo nao apaga a linha da tela: fica pronta ate a nova chegar', async () => {
    const tree = await comRota();
    let resolver!: (r: RouteSnapshot) => void;
    mockGetRoute.mockImplementationOnce(() => new Promise((res) => { resolver = res; }));

    await mover(tree, A_80_M);
    expect(visto.loadStatus).toBe('ready');
    expect(visto.route).not.toBeNull();

    const nova = rota({ distanceM: 42 });
    await act(async () => { resolver(nova); });
    expect(visto.route?.distanceM).toBe(42);
  });
});

describe('useEvacuationRoute: duas telas e respostas atrasadas', () => {
  it('com as duas telas montadas o recalculo sai uma vez so', async () => {
    const arvore = () =>
      createElement(EvacuationProvider, null, createElement(Harness), createElement(OutraTela));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(arvore()); });
    mockCoords = NA_LINHA;
    await act(async () => { tree.update(arvore()); });
    await act(async () => { jest.advanceTimersByTime(16_000); });
    // O dublê dá foco às duas de uma vez, então cada uma fez a sua busca
    // inicial; o que importa aqui é o recálculo.
    const antes = mockGetRoute.mock.calls.length;
    mockCoords = A_80_M;
    await act(async () => { tree.update(arvore()); });

    expect(mockGetRoute).toHaveBeenCalledTimes(antes + 1);
  });

  it('resposta velha que chega depois da nova nao sobrescreve a rota', async () => {
    const tree = await montar();
    await mover(tree, NA_LINHA); // primeira busca resolve: ha rota na tela

    let primeira!: (r: RouteSnapshot) => void;
    let segunda!: (r: RouteSnapshot) => void;
    mockGetRoute
      .mockImplementationOnce(() => new Promise((res) => { primeira = res; }))
      .mockImplementationOnce(() => new Promise((res) => { segunda = res; }));

    // Duas buscas em voo: a primeira demora mais de 15 s (rede ruim) e a
    // segunda sai porque a pessoa continua longe do tracado antigo.
    await act(async () => { jest.advanceTimersByTime(16_000); });
    await mover(tree, A_80_M);
    await act(async () => { jest.advanceTimersByTime(16_000); });
    await mover(tree, OUTRO_80_M);
    expect(mockGetRoute).toHaveBeenCalledTimes(3);

    await act(async () => { segunda(rota({ distanceM: 7 })); });
    await act(async () => { primeira(rota({ distanceM: 99 })); });
    expect(visto.route?.distanceM).toBe(7);
  });

  it('falha de rede no recalculo mantem a rota que ja estava na tela', async () => {
    const tree = await montar();
    await mover(tree, NA_LINHA);
    await act(async () => { jest.advanceTimersByTime(16_000); });
    mockGetRoute.mockRejectedValueOnce(new Error('network'));
    await mover(tree, A_80_M);

    expect(visto.loadStatus).toBe('ready');
    expect(visto.route).not.toBeNull();
    expect(visto.errorKind).toBeNull();
  });

  it('404 no recalculo apaga a rota: a evacuacao acabou', async () => {
    const tree = await montar();
    await mover(tree, NA_LINHA);
    await act(async () => { jest.advanceTimersByTime(16_000); });
    mockGetRoute.mockRejectedValueOnce(erro(404));
    await mover(tree, A_80_M);

    expect(visto.route).toBeNull();
    expect(visto.errorKind).toBe('no-evacuation');
  });
});

describe('useEvacuationRoute: motivo do erro', () => {
  it.each([
    [404, 'no-evacuation'],
    [409, 'no-position'],
    [500, 'failed'],
  ] as const)('status %s vira %s', async (status, kind) => {
    mockGetRoute.mockRejectedValue(erro(status));
    const tree = await montar();
    await mover(tree, NA_LINHA);

    expect(visto.loadStatus).toBe('error');
    expect(visto.errorKind).toBe(kind);
    // Erro nenhum deixa tracado velho na tela: rota falsa guia pro lugar errado.
    expect(visto.route).toBeNull();
  });

  it('erro sem status (rede fora) tambem e falha', async () => {
    mockGetRoute.mockRejectedValue(new Error('network'));
    const tree = await montar();
    await mover(tree, NA_LINHA);

    expect(visto.errorKind).toBe('failed');
  });
});
