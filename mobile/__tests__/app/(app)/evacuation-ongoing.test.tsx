import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import EvacuationOngoing from '../../../app/(app)/evacuation-ongoing';
import { SITE_ROUTE } from '../../../services/evacuation/types';
import type { RouteSnapshot } from '../../../services/evacuation/types';

// O traço (U+2014) é o que a chip mostra quando não há tempo pra exibir.
// Montado por código porque o caractere não entra no fonte (regra de escrita
// do projeto); a comparação é com ele de verdade.
const TRACO = String.fromCharCode(0x2014);

// Tela de evacuação EM ANDAMENTO (navegando). Difere da idle em três coisas que
// este teste trava: a linha é roxa em vez de ciano, não há pino de origem (quem
// caminha É a origem) e existe a seta de navegação girada na direção do próximo
// waypoint. O mapa também enquadra o meio do caminho, não a origem.

const mockEvac: {
  route: RouteSnapshot | null;
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  load: jest.Mock;
  reload: jest.Mock;
} = { route: null, loadStatus: 'idle', load: jest.fn(), reload: jest.fn() };
jest.mock('../../../services/evacuation/EvacuationProvider', () => ({
  useEvacuation: () => mockEvac,
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
      React.createElement(View, { testID: 'map-view', center: p.center, zoom: p.zoom }, p.children),
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
const WAYPOINTS: [number, number][] = [
  ...Array.from({ length: 5 }, (_, i) => [-46.632 + i * 0.001, -23.552] as [number, number]),
  ...Array.from({ length: 5 }, (_, i) => [-46.628, -23.552 + (i + 1) * 0.001] as [number, number]),
];

const rota = (over: Partial<RouteSnapshot> = {}): RouteSnapshot => ({
  waypoints: WAYPOINTS,
  durationSec: 1200,
  distanceM: 1500,
  fetchedAt: '2026-08-06T10:00:00.000Z',
  ...over,
});

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
});

describe('Evacuação em andamento: gate e enquadramento', () => {
  it('sem o gate "maps" mostra o placeholder e nenhum mapa', async () => {
    mockMapsEnabled = false;
    const tree = await render();

    expect(textos(tree)).toContain('Disponível na versão final');
    expect(porTestID(tree, 'map-view')).toBeUndefined();
  });

  // Navegando, o enquadramento útil é o caminho inteiro, não o ponto de partida.
  it('centra o mapa no meio do caminho entre origem e destino', async () => {
    const tree = await render();
    const mapa = porTestID(tree, 'map-view');

    expect(mapa.props.center).toEqual([
      (SITE_ROUTE.origin[0] + SITE_ROUTE.destination[0]) / 2,
      (SITE_ROUTE.origin[1] + SITE_ROUTE.destination[1]) / 2,
    ]);
    expect(mapa.props.zoom).toBe(15);
  });

  it('pede a rota ao provider no mount', async () => {
    await render();
    expect(mockEvac.load).toHaveBeenCalledTimes(1);
  });
});

describe('Evacuação em andamento: a linha da rota', () => {
  it('desenha os waypoints reais em roxo, a cor do estado navegando', async () => {
    mockEvac.route = rota();
    mockEvac.loadStatus = 'ready';
    const tree = await render();

    const linha = porTestID(tree, 'line-evacuation-ongoing-route');
    expect(linha.props.shape.geometry.coordinates).toEqual(WAYPOINTS);
    expect(linha.props.paint).toEqual({ color: '#BC88FF', width: 4, opacity: 0.95 });
  });

  it('quando a rota falha cai no segmento reto origem→destino', async () => {
    mockEvac.loadStatus = 'error';
    const tree = await render();

    const coords = porTestID(tree, 'line-evacuation-ongoing-route').props.shape.geometry
      .coordinates as [number, number][];
    expect(coords[0]).toEqual(SITE_ROUTE.origin);
    expect(coords[coords.length - 1]).toEqual(SITE_ROUTE.destination);
  });

  it.each(['idle', 'loading'] as const)(
    'em %s não desenha linha, seta nem chips',
    async (status) => {
      mockEvac.loadStatus = status;
      const tree = await render();

      expect(porTestID(tree, 'line-evacuation-ongoing-route')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-nav-arrow')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-ongoing-chip-1')).toBeUndefined();
    },
  );
});

describe('Evacuação em andamento: seta de navegação', () => {
  it('ancora a seta a 30% da rota e a gira para o próximo waypoint', async () => {
    mockEvac.route = rota();
    mockEvac.loadStatus = 'ready';
    const tree = await render();

    const seta = porTestID(tree, 'marker-evacuation-nav-arrow');
    expect(seta.props.coordinate).toEqual(WAYPOINTS[3]);

    // WAYPOINTS[3] → [4] anda para o leste: bússola 90°.
    const girado = seta.findAll((n) => Array.isArray(n.props?.style?.transform))[0];
    expect(girado.props.style.transform).toEqual([{ rotate: '90deg' }]);
  });

  it('no fallback reto a seta continua existindo: navegar sem seta não serve', async () => {
    mockEvac.loadStatus = 'error';
    const tree = await render();

    expect(porTestID(tree, 'marker-evacuation-nav-arrow')).toBeDefined();
  });
});

describe('Evacuação em andamento: pinos e chips', () => {
  // Quem caminha É a origem: um pino de partida aqui seria informação morta.
  it('mostra só o pino de destino, sem pino de origem', async () => {
    mockEvac.route = rota();
    mockEvac.loadStatus = 'ready';
    const tree = await render();

    expect(porTestID(tree, 'marker-evacuation-destination').props.coordinate).toEqual(
      SITE_ROUTE.destination,
    );
    expect(porTestID(tree, 'marker-evacuation-origin')).toBeUndefined();
  });

  it('ancora as chips a 35% e 70% e deriva os rótulos da duração real', async () => {
    mockEvac.route = rota({ durationSec: 1200 });
    mockEvac.loadStatus = 'ready';
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

  it('no fallback reto as chips não inventam tempo', async () => {
    mockEvac.loadStatus = 'error';
    const tree = await render();

    for (const id of ['marker-evacuation-ongoing-chip-1', 'marker-evacuation-ongoing-chip-2']) {
      const dentro = porTestID(tree, id)
        .findAll((n) => typeof n.props?.children === 'string')
        .map((n) => n.props.children as string);
      expect(dentro).toContain(TRACO);
    }
  });
});
