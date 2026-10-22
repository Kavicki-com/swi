import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import EvacuationOngoing from '../../../app/(app)/evacuation-ongoing';
import type { RouteSnapshot } from '../../../services/evacuation/types';
import type { RouteErrorKind } from '../../../services/evacuation/EvacuationProvider';

// Tela de evacuação EM ANDAMENTO (navegando). Difere da idle em três coisas que
// este teste trava: a linha é roxa em vez de ciano, não há pino de origem (quem
// caminha É a origem) e existe a seta de navegação, que fica onde o GPS diz
// que a pessoa está. O mapa enquadra o meio do caminho, não a origem.
//
// Destino e enquadramento vêm da rota do backend (ponto de encontro marcado
// pelo gestor), nunca de ponto fixo. Sem rota não há traçado: o aviso no topo
// diz o que fazer.

// Holder mutável: cada cenário reescreve o retorno do hook antes do render.
const mockEvac: {
  route: RouteSnapshot | null;
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  errorKind: RouteErrorKind;
  coords: [number, number] | null;
} = { route: null, loadStatus: 'idle', errorKind: null, coords: null };
jest.mock('../../../services/evacuation/useEvacuationRoute', () => ({
  useEvacuationRoute: () => mockEvac,
}));

let mockMapsEnabled = true;
jest.mock('../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../lib/featureFlags'),
  isFeatureEnabled: () => mockMapsEnabled,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

jest.mock('../../../components/MapView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MapView: (p: any) =>
      React.createElement(
        View,
        { testID: 'map-view', center: p.center, zoom: p.zoom, bounds: p.bounds },
        p.children,
      ),
  };
});
jest.mock('../../../components/MapLineSource', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { MapLineSource: (p: any) => React.createElement(View, { ...p, testID: `line-${p.id}` }) };
});
jest.mock('../../../components/MapMarker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MapMarker: (p: any) =>
      React.createElement(View, { testID: `marker-${p.id}`, coordinate: p.coordinate }, p.children),
  };
});
jest.mock('../../../components/NavFABs', () => ({ NavFABs: () => null }));
jest.mock('../../../components/EvacuationAckBar', () => ({ EvacuationAckBar: () => null }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// Rota em L: os 5 primeiros pontos andam para o LESTE e os 5 últimos para o
// NORTE. A seta ancora a 30% (índice 3), onde o próximo passo ainda é leste, e
// isso dá um bearing conferível à mão (90°).
// Longe de São Paulo de propósito: os pontos fixos do piloto ficavam lá.
const WAYPOINTS: [number, number][] = [
  ...Array.from({ length: 5 }, (_, i) => [-43.9 + i * 0.001, -19.9] as [number, number]),
  ...Array.from({ length: 5 }, (_, i) => [-43.896, -19.9 + (i + 1) * 0.001] as [number, number]),
];
const ORIGEM = WAYPOINTS[0];
const ENCONTRO = WAYPOINTS[9];
const BRASIL = [-73.99, -33.75, -34.79, 5.27];

const rota = (over: Partial<RouteSnapshot> = {}): RouteSnapshot => ({
  waypoints: WAYPOINTS,
  durationSec: 1200,
  distanceM: 1500,
  fetchedAt: '2026-08-06T10:00:00.000Z',
  origin: ORIGEM,
  destination: ENCONTRO,
  approximate: false,
  ...over,
});

const pronta = (over: Partial<RouteSnapshot> = {}) => {
  mockEvac.route = rota(over);
  mockEvac.loadStatus = 'ready';
};

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <EvacuationOngoing />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const porTestID = (tree: ReturnType<typeof create>, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

const textos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

beforeEach(() => {
  jest.clearAllMocks();
  mockMapsEnabled = true;
  mockEvac.route = null;
  mockEvac.loadStatus = 'idle';
  mockEvac.errorKind = null;
  mockEvac.coords = null;
});

describe('Evacuação em andamento: gate e enquadramento', () => {
  it('sem o gate "maps" mostra o placeholder e nenhum mapa', async () => {
    mockMapsEnabled = false;
    const tree = await render();

    expect(textos(tree)).toContain('Disponível na versão final');
    expect(porTestID(tree, 'map-view')).toBeUndefined();
  });

  // Navegando, o enquadramento útil é o caminho inteiro, não o ponto de partida.
  it('centra o mapa no meio do caminho entre a origem e o ponto de encontro', async () => {
    pronta();
    const tree = await render();
    const mapa = porTestID(tree, 'map-view');

    expect(mapa.props.center).toEqual([
      (ORIGEM[0] + ENCONTRO[0]) / 2,
      (ORIGEM[1] + ENCONTRO[1]) / 2,
    ]);
    expect(mapa.props.zoom).toBe(15);
  });

  it('sem rota e sem GPS enquadra o Brasil, sem centro', async () => {
    const tree = await render();
    const mapa = porTestID(tree, 'map-view');

    expect(mapa.props.center).toBeUndefined();
    expect(mapa.props.bounds).toEqual(BRASIL);
  });
});

describe('Evacuação em andamento: a linha da rota', () => {
  it('desenha os waypoints reais em roxo, a cor do estado navegando', async () => {
    pronta();
    const tree = await render();

    const linha = porTestID(tree, 'line-evacuation-ongoing-route');
    expect(linha.props.shape.geometry.coordinates).toEqual(WAYPOINTS);
    expect(linha.props.paint).toEqual({ color: '#BC88FF', width: 4, opacity: 0.95 });
  });

  it.each(['idle', 'loading'] as const)(
    'em %s não desenha linha, seta, chips nem ponto de encontro',
    async (status) => {
      mockEvac.loadStatus = status;
      const tree = await render();

      expect(porTestID(tree, 'line-evacuation-ongoing-route')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-nav-arrow')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-ongoing-chip-1')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-destination')).toBeUndefined();
    },
  );
});

describe('Evacuação em andamento: aviso da rota', () => {
  // A tela antiga caía numa reta entre dois pontos fixos quando a rota falhava,
  // e a seta navegava por ela. Agora erro é frase, sem traçado.
  it.each([
    ['no-evacuation', 'Nenhuma evacuação em andamento com ponto de encontro.'],
    ['no-position', 'Ative a localização para traçar a rota.'],
    ['failed', 'Não foi possível traçar a rota. Siga as orientações do gestor.'],
  ] as const)('erro %s: sem linha nem seta, com a frase do motivo', async (kind, frase) => {
    mockEvac.loadStatus = 'error';
    mockEvac.errorKind = kind;
    mockEvac.coords = [-43.9, -19.9];
    const tree = await render();

    expect(porTestID(tree, 'line-evacuation-ongoing-route')).toBeUndefined();
    expect(porTestID(tree, 'marker-evacuation-nav-arrow')).toBeUndefined();
    expect(porTestID(tree, 'evacuation-route-notice')).toBeDefined();
    expect(textos(tree)).toContain(frase);
  });

  it('rota aproximada mantém a linha e avisa para seguir o gestor', async () => {
    pronta({ approximate: true });
    const tree = await render();

    expect(porTestID(tree, 'line-evacuation-ongoing-route')).toBeDefined();
    expect(textos(tree)).toContain('Rota aproximada: siga as orientações do gestor.');
  });

  it('rota normal não mostra aviso', async () => {
    pronta();
    const tree = await render();

    expect(porTestID(tree, 'evacuation-route-notice')).toBeUndefined();
  });
});

describe('Evacuação em andamento: seta de navegação', () => {
  it('sem GPS ancora a seta a 30% da rota e a gira para o próximo waypoint', async () => {
    pronta();
    const tree = await render();

    const seta = porTestID(tree, 'marker-evacuation-nav-arrow');
    expect(seta.props.coordinate).toEqual(WAYPOINTS[3]);

    // WAYPOINTS[3] → [4] anda para o leste: bússola 90°.
    const girado = seta.findAll((n) => Array.isArray(n.props?.style?.transform))[0];
    expect(girado.props.style.transform).toEqual([{ rotate: '90deg' }]);
  });

  it('com GPS a seta fica onde a pessoa está, apontando para o próximo waypoint', async () => {
    pronta();
    // Mais perto de WAYPOINTS[6] ([-43.896, -19.898]); o próximo é [7], ao norte.
    const aqui: [number, number] = [-43.896, -19.8981];
    mockEvac.coords = aqui;
    const tree = await render();

    const seta = porTestID(tree, 'marker-evacuation-nav-arrow');
    expect(seta.props.coordinate).toEqual(aqui);
    const girado = seta.findAll((n) => Array.isArray(n.props?.style?.transform))[0];
    expect(girado.props.style.transform).toEqual([{ rotate: '0deg' }]);
  });
});

describe('Evacuação em andamento: pinos e chips', () => {
  // Quem caminha É a origem: um pino de partida aqui seria informação morta.
  it('mostra só o pino do ponto de encontro, sem pino de origem', async () => {
    pronta();
    const tree = await render();

    expect(porTestID(tree, 'marker-evacuation-destination').props.coordinate).toEqual(ENCONTRO);
    expect(porTestID(tree, 'marker-evacuation-origin')).toBeUndefined();
  });

  it('ancora as chips a 35% e 70% e deriva os rótulos da duração real', async () => {
    pronta({ durationSec: 1200 });
    const tree = await render();

    expect(porTestID(tree, 'marker-evacuation-ongoing-chip-1').props.coordinate).toEqual(
      WAYPOINTS[3],
    );
    expect(porTestID(tree, 'marker-evacuation-ongoing-chip-2').props.coordinate).toEqual(
      WAYPOINTS[7],
    );

    const t = textos(tree);
    expect(t).toContain('7 minutos');
    expect(t).toContain('14 minutos');
  });
});
