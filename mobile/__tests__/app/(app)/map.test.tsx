import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import MapaGeral from '../../../app/(app)/map';
import type { WorkerTelemetry } from '../../../services/telemetry/myTelemetry';
import {
  condition,
  neverReported,
  reporting,
} from '../../../services/telemetry/myTelemetryFixtures';

// Mapa geral. O teste olha o que a tela MANDA pro mapa, nao o que o mapa
// desenha, e trava duas coisas:
//
// 1. Os aneis de distancia sao geometria em METROS em volta da posicao real
//    (medidos aqui com haversine propria), nao circulos de pixel.
// 2. Nada na tela e inventado. Colegas e calor vem do backend de posicoes; sem
//    GPS nao existe pino proprio nem anel, e o mapa enquadra os colegas ou o
//    Brasil. A tela ja desenhou sete pessoas fixas e um calor sorteado em volta
//    de um ponto de Sao Paulo, para qualquer usuario em qualquer lugar.

const MINA: [number, number] = [-43.9, -19.9];
const BRASIL = [-73.99, -33.75, -34.79, 5.27];

let mockCoords: [number, number] | null = [-43.9, -19.9];
jest.mock('@/services/location/LocationProvider', () => ({
  useLocation: () => ({ coords: mockCoords, permission: 'granted' }),
}));
jest.mock('@/services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: { avatarUrl: '' } }),
}));
// O estado do pino próprio sai da leitura de me/current, não do simulador.
let mockTelemetry: WorkerTelemetry | null = null;
jest.mock('@/services/vitals/useMyTelemetry', () => ({
  useMyTelemetry: () => ({ telemetry: mockTelemetry, failed: false, loading: false }),
}));
jest.mock('@/lib/featureFlags', () => ({
  ...jest.requireActual('@/lib/featureFlags'),
  isFeatureEnabled: () => true, // o gate 'maps' so liga em build nativa
}));

const mockListColleagues = jest.fn();
const mockHeat = jest.fn();
jest.mock('@/services/positions/getPositionsBackend', () => ({
  getPositionsBackend: () => ({
    heartbeat: jest.fn(),
    listColleagues: () => mockListColleagues(),
    heat: () => mockHeat(),
  }),
}));

// Fronteira do MapLibre dublada: MapView vira um passa-children que guarda o
// enquadramento pedido; cada filho de mapa vira uma View com os proprios props.
jest.mock('@/components/MapView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MapView: (p: any) =>
      React.createElement(
        View,
        { testID: 'mapview', center: p.center, bounds: p.bounds, zoom: p.zoom },
        p.children,
      ),
  };
});
jest.mock('@/components/MapLineSource', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MapLineSource: (p: any) => React.createElement(View, { testID: `line-${p.id}`, ...p }),
  };
});
jest.mock('@/components/MapMarker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MapMarker: (p: any) =>
      React.createElement(View, { testID: `marker-${p.id}`, coordinate: p.coordinate }, p.children),
  };
});
jest.mock('@/components/MapHeatmapSource', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MapHeatmapSource: (p: any) =>
      React.createElement(View, { testID: `heat-${p.id}`, shape: p.shape, paint: p.paint }),
  };
});
jest.mock('@/components/NavFABs', () => ({ NavFABs: () => null }));

// Oraculo independente (mesma haversine do teste de mapGeometry, escrita aqui
// de proposito em vez de importada do codigo sob teste).
const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
function metrosEntre(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const colega = (id: string, lng: number, lat: number, extra: object = {}) => ({
  id,
  name: `Colega ${id}`,
  lat,
  lng,
  sector: null,
  avatar: `https://fotos.exemplo/${id}.jpg`,
  recordedAt: '2026-10-03T12:00:00.000Z',
  status: 'good',
  ...extra,
});

const calor = (cells: { lat: number; lng: number; weight: number }[]) => ({
  cellSizeM: 50,
  from: '2026-10-02T12:00:00.000Z',
  to: '2026-10-03T12:00:00.000Z',
  cells,
});

let arvores: ReactTestRenderer[] = [];
const render = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SwiThemeProvider>
        <MapaGeral />
      </SwiThemeProvider>,
    );
  });
  arvores.push(tree);
  return tree;
};

const porTestID = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

// findAll devolve o componente dublado E a View que ele renderiza, os dois com
// o mesmo testID. Contar precisa passar pelo conjunto de ids distintos.
const idsCom = (tree: ReactTestRenderer, prefixo: string) =>
  Array.from(
    new Set(
      tree.root
        .findAll((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith(prefixo))
        .map((n) => n.props.testID as string),
    ),
  );

const porRotulo = (tree: ReactTestRenderer, rotulo: string) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === rotulo && typeof n.props?.onPress === 'function',
  )[0];

const tocar = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onPress();
  });
};

const avancar = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

// O pino do DS dentro de um marcador: e ele quem recebe nome, foto e estado.
const pinoDe = (tree: ReactTestRenderer, id: string) =>
  porTestID(tree, id).findAll((n) => n.props?.variant === 'avatar')[0];

beforeEach(() => {
  jest.useFakeTimers();
  mockCoords = [-43.9, -19.9];
  mockTelemetry = reporting();
  mockListColleagues.mockReset().mockResolvedValue([]);
  mockHeat.mockReset().mockResolvedValue(calor([]));
});

afterEach(async () => {
  await act(async () => {
    arvores.forEach((t) => t.unmount());
  });
  arvores = [];
  jest.useRealTimers();
});

describe('Mapa geral: aneis de distancia (QA Mobile #10)', () => {
  it.each([
    ['radius-5000', 5000],
    ['radius-10000', 10000],
  ])('%s tem todo vertice a %d metros da posicao do usuario', async (id, metros) => {
    const tree = await render();
    const anel = porTestID(tree, `line-${id}`);

    expect(anel).toBeDefined();
    const vertices = anel.props.shape.geometry.coordinates as [number, number][];
    expect(vertices.length).toBeGreaterThan(16);
    for (const v of vertices) {
      expect(metrosEntre(MINA, v)).toBeCloseTo(metros as number, 0);
    }
  });

  it('ancora cada rotulo na borda sul do proprio anel, em metros', async () => {
    const tree = await render();

    for (const [id, metros] of [
      ['radius-5000-label', 5000],
      ['radius-10000-label', 10000],
    ] as const) {
      const marcador = porTestID(tree, `marker-${id}`);
      expect(marcador).toBeDefined();
      const at = marcador.props.coordinate as [number, number];
      expect(metrosEntre(MINA, at)).toBeCloseTo(metros, 0);
      expect(at[1]).toBeLessThan(MINA[1]); // sul
    }
  });

  it('o texto do rotulo sai do mesmo numero que desenha o anel', async () => {
    const tree = await render();
    const textos = tree.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string);
    expect(textos).toContain('5KM');
    expect(textos).toContain('10KM');
  });

  // Trava: nenhum circulo com tamanho cravado em pixel pode sobrar na tela.
  it('nao restou anel dimensionado em pixels', async () => {
    const tree = await render();
    const fixos = tree.root.findAll(
      (n) => n.props?.style?.width === 395 || n.props?.style?.width === 647,
    );
    expect(fixos).toHaveLength(0);
  });
});

describe('Mapa geral: com GPS', () => {
  it('centra na posicao do aparelho e desenha o pino proprio nela', async () => {
    const tree = await render();
    const mapa = porTestID(tree, 'mapview');

    expect(mapa.props.center).toEqual(MINA);
    expect(mapa.props.bounds).toBeUndefined();
    expect(mapa.props.zoom).toBe(14);
    expect(porTestID(tree, 'marker-user-pin').props.coordinate).toEqual(MINA);
  });

  it('nao le colega nem calor enquanto as camadas estao desligadas', async () => {
    await render();
    await avancar(60_000);

    expect(mockListColleagues).not.toHaveBeenCalled();
    expect(mockHeat).not.toHaveBeenCalled();
  });
});

describe('Mapa geral: sem GPS', () => {
  beforeEach(() => {
    mockCoords = null;
  });

  it('nao desenha pino proprio nem aneis: nao ha de onde medir', async () => {
    const tree = await render();

    expect(porTestID(tree, 'marker-user-pin')).toBeUndefined();
    expect(idsCom(tree, 'line-radius-')).toHaveLength(0);
    expect(idsCom(tree, 'marker-radius-')).toHaveLength(0);
  });

  it('sem colega nenhum, enquadra o Brasil em vez de um ponto de reserva', async () => {
    const tree = await render();
    const mapa = porTestID(tree, 'mapview');

    expect(mapa.props.center).toBeUndefined();
    expect(mapa.props.bounds).toEqual(BRASIL);
  });

  it('le os colegas mesmo com a camada desligada e enquadra onde eles estao', async () => {
    mockListColleagues.mockResolvedValue([colega('a', -48.5, -27.6), colega('b', -48.3, -27.4)]);
    const tree = await render();
    const [oeste, sul, leste, norte] = porTestID(tree, 'mapview').props.bounds as number[];

    expect(oeste).toBeLessThanOrEqual(-48.5);
    expect(leste).toBeGreaterThanOrEqual(-48.3);
    expect(sul).toBeLessThanOrEqual(-27.6);
    expect(norte).toBeGreaterThanOrEqual(-27.4);
    // Enquadrar nao liga a camada: os pinos so aparecem pelo botao.
    expect(idsCom(tree, 'marker-worker-')).toHaveLength(0);
  });

  // Reenquadrar a cada releitura arrancaria o mapa da mao de quem o arrastou.
  it('o enquadramento dos colegas nao muda quando a releitura traz posicoes novas', async () => {
    mockListColleagues.mockResolvedValue([colega('a', -48.5, -27.6)]);
    const tree = await render();
    const antes = porTestID(tree, 'mapview').props.bounds;

    mockListColleagues.mockResolvedValue([colega('a', -40.0, -20.0)]);
    await tocar(porRotulo(tree, 'Operadores'));
    await avancar(15_000);

    expect(porTestID(tree, 'marker-worker-a').props.coordinate).toEqual([-40.0, -20.0]);
    expect(porTestID(tree, 'mapview').props.bounds).toBe(antes);
  });

  it('enquadrado, para de ler os colegas enquanto a camada segue desligada', async () => {
    mockListColleagues.mockResolvedValue([colega('a', -48.5, -27.6)]);
    await render();
    await avancar(60_000);

    expect(mockListColleagues).toHaveBeenCalledTimes(1);
  });

  it('sem ninguem na primeira leitura, fica no Brasil e nao insiste', async () => {
    const tree = await render();
    await avancar(60_000);

    expect(mockListColleagues).toHaveBeenCalledTimes(1);
    expect(porTestID(tree, 'mapview').props.bounds).toEqual(BRASIL);
  });

  it('se a leitura falha, tenta de novo ate conseguir enquadrar', async () => {
    mockListColleagues
      .mockRejectedValueOnce(new Error('sem rede'))
      .mockResolvedValue([colega('a', -48.5, -27.6)]);
    const tree = await render();
    expect(porTestID(tree, 'mapview').props.bounds).toEqual(BRASIL);

    await avancar(15_000);

    const [oeste, , leste] = porTestID(tree, 'mapview').props.bounds as number[];
    expect(oeste).toBeLessThanOrEqual(-48.5);
    expect(leste).toBeGreaterThanOrEqual(-48.5);
    expect(leste - oeste).toBeLessThan(1); // a caixa do colega, nao o pais
  });

  it('quando a primeira leitura do GPS chega, o mapa centra nela e ganha pino e aneis', async () => {
    const tree = await render();
    expect(porTestID(tree, 'mapview').props.center).toBeUndefined();

    mockCoords = [-43.9, -19.9];
    await act(async () => {
      tree.update(
        <SwiThemeProvider>
          <MapaGeral />
        </SwiThemeProvider>,
      );
    });

    const mapa = porTestID(tree, 'mapview');
    expect(mapa.props.center).toEqual(MINA);
    expect(mapa.props.bounds).toBeUndefined();
    expect(porTestID(tree, 'marker-user-pin').props.coordinate).toEqual(MINA);
    expect(idsCom(tree, 'line-radius-')).toHaveLength(2);
  });
});

describe('Mapa geral: colegas', () => {
  it('a camada liga com os colegas do backend, na posicao e com a foto de cada um', async () => {
    mockListColleagues.mockResolvedValue([colega('a', -43.91, -19.91), colega('b', -43.89, -19.92)]);
    const tree = await render();
    expect(idsCom(tree, 'marker-worker-')).toHaveLength(0);

    await tocar(porRotulo(tree, 'Operadores'));

    expect(idsCom(tree, 'marker-worker-').sort()).toEqual(['marker-worker-a', 'marker-worker-b']);
    expect(porTestID(tree, 'marker-worker-a').props.coordinate).toEqual([-43.91, -19.91]);
    expect(pinoDe(tree, 'marker-worker-a').props).toMatchObject({
      name: 'Colega a',
      avatarUri: 'https://fotos.exemplo/a.jpg',
      status: 'good',
    });
  });

  it('o estado de saude do colega chega ao pino; sem leitura vira offline', async () => {
    mockListColleagues.mockResolvedValue([
      colega('a', -43.91, -19.91, { status: 'alert' }),
      colega('b', -43.89, -19.92, { status: 'low' }),
      colega('c', -43.88, -19.93, { status: 'unknown' }),
    ]);
    const tree = await render();
    await tocar(porRotulo(tree, 'Operadores'));

    expect(pinoDe(tree, 'marker-worker-a').props.status).toBe('alert');
    expect(pinoDe(tree, 'marker-worker-b').props.status).toBe('low');
    expect(pinoDe(tree, 'marker-worker-c').props.status).toBe('offline');
  });

  it('o pino proprio usa o estado da leitura real; sem leitura vira offline', async () => {
    mockTelemetry = { ...reporting(), conditions: [condition('URGENT')] };
    expect(pinoDe(await render(), 'marker-user-pin').props.status).toBe('low');

    mockTelemetry = reporting();
    expect(pinoDe(await render(), 'marker-user-pin').props.status).toBe('good');

    mockTelemetry = neverReported();
    expect(pinoDe(await render(), 'marker-user-pin').props.status).toBe('offline');

    mockTelemetry = null;
    expect(pinoDe(await render(), 'marker-user-pin').props.status).toBe('offline');
  });

  it('rele a cada 15 segundos e acompanha quem entrou e quem saiu', async () => {
    mockListColleagues.mockResolvedValue([colega('a', -43.91, -19.91)]);
    const tree = await render();
    await tocar(porRotulo(tree, 'Operadores'));

    mockListColleagues.mockResolvedValue([colega('b', -43.89, -19.92)]);
    await avancar(15_000);

    expect(idsCom(tree, 'marker-worker-')).toEqual(['marker-worker-b']);
  });

  it('desligar tira os pinos e para de ler', async () => {
    mockListColleagues.mockResolvedValue([colega('a', -43.91, -19.91)]);
    const tree = await render();
    await tocar(porRotulo(tree, 'Operadores'));
    await tocar(porRotulo(tree, 'Operadores'));

    expect(idsCom(tree, 'marker-worker-')).toHaveLength(0);
    const leituras = mockListColleagues.mock.calls.length;
    await avancar(60_000);
    expect(mockListColleagues).toHaveBeenCalledTimes(leituras);
  });

  it('falha na leitura deixa o mapa sem colegas, nunca com colegas inventados', async () => {
    mockListColleagues.mockRejectedValue(new Error('sem rede'));
    const tree = await render();
    await tocar(porRotulo(tree, 'Operadores'));

    expect(idsCom(tree, 'marker-worker-')).toHaveLength(0);
    expect(porTestID(tree, 'mapview')).toBeDefined();
  });
});

describe('Mapa geral: calor', () => {
  it('a camada sai das celulas do backend, com o peso relativo a celula mais quente', async () => {
    mockHeat.mockResolvedValue(
      calor([
        { lat: -19.9, lng: -43.9, weight: 30 },
        { lat: -19.91, lng: -43.91, weight: 15 },
      ]),
    );
    const tree = await render();
    expect(idsCom(tree, 'heat-')).toHaveLength(0);

    await tocar(porRotulo(tree, 'Heatmap'));

    const features = porTestID(tree, 'heat-productivity-heatmap').props.shape.features as {
      geometry: { coordinates: [number, number] };
      properties: { weight: number };
    }[];
    expect(features.map((f) => f.geometry.coordinates)).toEqual([
      [-43.9, -19.9],
      [-43.91, -19.91],
    ]);
    expect(features.map((f) => f.properties.weight)).toEqual([1, 0.5]);
  });

  it('depois de uma falha, tenta de novo em 30 segundos, sem esperar os 5 minutos', async () => {
    mockHeat
      .mockRejectedValueOnce(new Error('sem rede'))
      .mockResolvedValue(calor([{ lat: -19.9, lng: -43.9, weight: 4 }]));
    const tree = await render();
    await tocar(porRotulo(tree, 'Heatmap'));
    expect(idsCom(tree, 'heat-')).toHaveLength(0);

    await avancar(30_000);

    expect(idsCom(tree, 'heat-')).toEqual(['heat-productivity-heatmap']);
  });

  it('sem presenca registrada nao desenha camada nenhuma', async () => {
    const tree = await render();
    await tocar(porRotulo(tree, 'Heatmap'));

    expect(mockHeat).toHaveBeenCalledTimes(1);
    expect(idsCom(tree, 'heat-')).toHaveLength(0);
  });

  it('nenhum ponto de calor e sorteado', async () => {
    const sorteio = jest.spyOn(Math, 'random');
    mockHeat.mockResolvedValue(calor([{ lat: -19.9, lng: -43.9, weight: 4 }]));
    const tree = await render();
    await tocar(porRotulo(tree, 'Heatmap'));

    expect(porTestID(tree, 'heat-productivity-heatmap').props.shape.features).toHaveLength(1);
    expect(sorteio).not.toHaveBeenCalled();
    sorteio.mockRestore();
  });

  it('ligar outra camada nao refaz a forma do calor', async () => {
    mockHeat.mockResolvedValue(calor([{ lat: -19.9, lng: -43.9, weight: 4 }]));
    const tree = await render();
    await tocar(porRotulo(tree, 'Heatmap'));
    const antes = porTestID(tree, 'heat-productivity-heatmap').props.shape;

    await tocar(porRotulo(tree, 'Câmeras'));

    expect(porTestID(tree, 'heat-productivity-heatmap').props.shape).toBe(antes);
  });

  it('desligar tira a camada', async () => {
    mockHeat.mockResolvedValue(calor([{ lat: -19.9, lng: -43.9, weight: 4 }]));
    const tree = await render();
    await tocar(porRotulo(tree, 'Heatmap'));
    await tocar(porRotulo(tree, 'Heatmap'));

    expect(idsCom(tree, 'heat-')).toHaveLength(0);
  });
});

describe('Mapa geral: cameras', () => {
  it('comecam escondidas, aparecem no primeiro toque e somem no segundo', async () => {
    const tree = await render();
    expect(idsCom(tree, 'marker-camera-')).toHaveLength(0);

    await tocar(porRotulo(tree, 'Câmeras'));
    expect(idsCom(tree, 'marker-camera-')).toHaveLength(12);

    await tocar(porRotulo(tree, 'Câmeras'));
    expect(idsCom(tree, 'marker-camera-')).toHaveLength(0);
  });
});
