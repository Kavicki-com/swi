import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import EvacuationRoute from '../../../app/(app)/evacuation';
import { SITE_ROUTE } from '../../../services/evacuation/types';
import type { RouteSnapshot } from '../../../services/evacuation/types';

// Tela de evacuação (idle, "rota planejada"). É tela de SEGURANÇA: o que ela
// manda pro mapa é a instrução que a pessoa vai seguir saindo do site, então o
// teste mede os dados enviados ao mapa (linha, âncoras das chips, rótulos de
// tempo, pinos) e não o desenho.
//
// Os três estados do provider têm consequência visual diferente e cada um está
// coberto aqui: `ready` desenha a rota real, `error` cai no fallback reto (o
// mapa NUNCA pode ficar sem linha), `idle`/`loading` mostram só os pinos.

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

// Holder mutável: cada cenário reescreve o retorno do provider antes do render.
const mockEvac: {
  route: RouteSnapshot | null;
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  load: jest.Mock;
  reload: jest.Mock;
} = { route: null, loadStatus: 'idle', load: jest.fn(), reload: jest.fn() };
jest.mock('../../../services/evacuation/EvacuationProvider', () => ({
  useEvacuation: () => mockEvac,
}));

// O gate 'maps' só liga em build nativa; aqui ele é ligado/desligado por cenário.
let mockMapsEnabled = true;
jest.mock('../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../lib/featureFlags'),
  isFeatureEnabled: () => mockMapsEnabled,
}));

// Fronteira do mapa dublada: MapView passa os filhos adiante e carrega os
// próprios props pra inspeção; cada filho de mapa vira View com testID.
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
// A barra de confirmação tem backend próprio e suíte própria: fora daqui.
jest.mock('../../../components/EvacuationAckBar', () => ({ EvacuationAckBar: () => null }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// Rota real de 10 pontos: com esse tamanho as âncoras a 35% / 70% caem em
// índices distintos (3 e 7), o que deixa o teste de âncora significativo.
const WAYPOINTS: [number, number][] = Array.from({ length: 10 }, (_, i) => [
  -46.632 + i * 0.001,
  -23.552 + i * 0.0008,
]);

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
          <EvacuationRoute />
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

describe('Tela de evacuação — gate de plataforma', () => {
  it('sem o gate "maps" mostra o placeholder e nenhum mapa', async () => {
    mockMapsEnabled = false;
    const tree = await render();

    expect(textos(tree)).toContain('Disponível na versão final');
    expect(porTestID(tree, 'map-view')).toBeUndefined();
  });

  it('com o gate ligado monta o mapa centrado na origem da rota', async () => {
    const tree = await render();
    const mapa = porTestID(tree, 'map-view');

    expect(mapa.props.center).toEqual(SITE_ROUTE.origin);
    expect(mapa.props.zoom).toBe(15);
  });
});

describe('Tela de evacuação — carregamento da rota', () => {
  it('pede a rota ao provider no mount', async () => {
    await render();
    expect(mockEvac.load).toHaveBeenCalledTimes(1);
  });

  it.each(['idle', 'loading'] as const)(
    'em %s desenha só os pinos: sem linha e sem chips de tempo',
    async (status) => {
      mockEvac.loadStatus = status;
      const tree = await render();

      expect(porTestID(tree, 'line-evacuation-route')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-chip-1')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-chip-2')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-origin')).toBeDefined();
      expect(porTestID(tree, 'marker-evacuation-destination')).toBeDefined();
    },
  );

  it('com a rota pronta manda ao mapa exatamente os waypoints do provider', async () => {
    mockEvac.route = rota();
    mockEvac.loadStatus = 'ready';
    const tree = await render();

    const linha = porTestID(tree, 'line-evacuation-route');
    expect(linha.props.shape.geometry.type).toBe('LineString');
    expect(linha.props.shape.geometry.coordinates).toEqual(WAYPOINTS);
    expect(linha.props.paint).toEqual({ color: '#8AD2E2', width: 4, opacity: 0.95 });
  });

  // Trava do fallback: se a busca da rota falha, a tela de segurança continua
  // mostrando um caminho origem→destino em vez de um mapa vazio.
  it('quando a rota falha desenha o segmento reto origem→destino', async () => {
    mockEvac.loadStatus = 'error';
    const tree = await render();

    const coords = porTestID(tree, 'line-evacuation-route').props.shape.geometry
      .coordinates as [number, number][];
    expect(coords).toHaveLength(5);
    expect(coords[0]).toEqual(SITE_ROUTE.origin);
    expect(coords[coords.length - 1]).toEqual(SITE_ROUTE.destination);
  });

  it('no fallback reto as chips não inventam tempo: mostram "—"', async () => {
    mockEvac.loadStatus = 'error';
    const tree = await render();

    // Por chip, não pela árvore inteira: o mesmo texto reaparece em cada nível
    // aninhado do Text do DS, então contar na árvore mediria a profundidade.
    for (const id of ['marker-evacuation-chip-1', 'marker-evacuation-chip-2']) {
      const chip = porTestID(tree, id);
      const dentro = chip
        .findAll((n) => typeof n.props?.children === 'string')
        .map((n) => n.props.children as string);
      expect(dentro).toContain('—');
      expect(dentro.some((s) => s.includes('minuto'))).toBe(false);
    }
  });
});

describe('Tela de evacuação — chips de tempo ancoradas na rota', () => {
  it('ancora as duas chips a 35% e 70% dos waypoints', async () => {
    mockEvac.route = rota();
    mockEvac.loadStatus = 'ready';
    const tree = await render();

    expect(porTestID(tree, 'marker-evacuation-chip-1').props.coordinate).toEqual(WAYPOINTS[3]);
    expect(porTestID(tree, 'marker-evacuation-chip-2').props.coordinate).toEqual(WAYPOINTS[7]);
  });

  // Os rótulos eram "6 minutos"/"17 minutos" cravados do mockup; agora saem da
  // duração real, cada um no tempo acumulado até a própria âncora.
  it('deriva cada rótulo da duração real na fração em que a chip ancora', async () => {
    mockEvac.route = rota({ durationSec: 1200 }); // 20 min → 35% = 7, 70% = 14
    mockEvac.loadStatus = 'ready';
    const tree = await render();

    const t = textos(tree);
    expect(t).toContain('7 minutos');
    expect(t).toContain('14 minutos');
  });

  it('usa o singular quando o trecho arredonda para um minuto', async () => {
    mockEvac.route = rota({ durationSec: 100 }); // 35% ≈ 0,6 min → piso de 1
    mockEvac.loadStatus = 'ready';
    const tree = await render();

    expect(textos(tree)).toContain('1 minuto');
  });
});

describe('Tela de evacuação — pinos e conteúdo do cartão', () => {
  it('põe os pinos de início e destino nas coordenadas do site', async () => {
    const tree = await render();

    expect(porTestID(tree, 'marker-evacuation-origin').props.coordinate).toEqual(
      SITE_ROUTE.origin,
    );
    expect(porTestID(tree, 'marker-evacuation-destination').props.coordinate).toEqual(
      SITE_ROUTE.destination,
    );
  });

  it('mostra o título do procedimento e a orientação de abrigo', async () => {
    const tree = await render();
    const t = textos(tree);

    expect(t).toContain('Procedimento de evacuação');
    expect(t).toContain('Rota de evacuação');
    expect(t.some((s) => s.includes('encontre um abrigo seguro'))).toBe(true);
  });

  it('"Continuar" leva para a evacuação em andamento', async () => {
    const tree = await render();
    const botao = tree.root.findAll(
      (n) =>
        n.props?.accessibilityLabel === 'Continuar evacuação' &&
        typeof n.props?.onPress === 'function',
    )[0];

    expect(botao).toBeDefined();
    await act(async () => { botao.props.onPress(); });

    expect(mockPush).toHaveBeenCalledWith('/(app)/evacuation-ongoing');
  });
});
