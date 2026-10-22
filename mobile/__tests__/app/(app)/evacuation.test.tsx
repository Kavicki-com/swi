import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import EvacuationRoute from '../../../app/(app)/evacuation';
import type { RouteSnapshot } from '../../../services/evacuation/types';
import type { RouteErrorKind } from '../../../services/evacuation/EvacuationProvider';

// Tela de evacuação (idle, "rota planejada"). É tela de SEGURANÇA: o que ela
// manda pro mapa é a instrução que a pessoa vai seguir saindo do site, então o
// teste mede os dados enviados ao mapa (linha, âncoras das chips, rótulos de
// tempo, pinos) e não o desenho.
//
// A rota sai da posição da pessoa e vai até o ponto de encontro que o gestor
// marcou; nada aqui pode vir de ponto fixo. Sem rota (carregando ou erro) a tela
// NÃO desenha traçado nenhum: cada motivo de erro tem a própria frase.

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

// Holder mutável: cada cenário reescreve o retorno do hook antes do render. A
// busca, o recálculo e o motivo do erro têm suíte própria
// (services/evacuation/useEvacuationRoute.test.tsx); aqui só o que a tela faz
// com o resultado.
const mockEvac: {
  route: RouteSnapshot | null;
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  errorKind: RouteErrorKind;
  coords: [number, number] | null;
} = { route: null, loadStatus: 'idle', errorKind: null, coords: null };
jest.mock('../../../services/evacuation/useEvacuationRoute', () => ({
  useEvacuationRoute: () => mockEvac,
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
// A barra de confirmação tem backend próprio e suíte própria: fora daqui.
jest.mock('../../../components/EvacuationAckBar', () => ({ EvacuationAckBar: () => null }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// Rota real de 10 pontos: com esse tamanho as âncoras a 35% / 70% caem em
// índices distintos (3 e 7), o que deixa o teste de âncora significativo.
// Longe de São Paulo de propósito: os pontos fixos do piloto ficavam lá, e um
// teste em São Paulo não pegaria a tela voltando a usá-los.
const WAYPOINTS: [number, number][] = Array.from({ length: 10 }, (_, i) => [
  -43.9 + i * 0.001,
  -19.9 + i * 0.0008,
]);
const ORIGEM = WAYPOINTS[0];
const ENCONTRO = WAYPOINTS[9];
const GPS: [number, number] = [-43.9002, -19.9001];
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
  mockEvac.errorKind = null;
  mockEvac.coords = null;
});

describe('Tela de evacuação: gate de plataforma', () => {
  it('sem o gate "maps" mostra o placeholder e nenhum mapa', async () => {
    mockMapsEnabled = false;
    const tree = await render();

    expect(textos(tree)).toContain('Disponível na versão final');
    expect(porTestID(tree, 'map-view')).toBeUndefined();
  });
});

describe('Tela de evacuação: enquadramento', () => {
  it('com a rota centra o mapa na origem que o backend usou', async () => {
    pronta();
    const tree = await render();
    const mapa = porTestID(tree, 'map-view');

    expect(mapa.props.center).toEqual(ORIGEM);
    expect(mapa.props.zoom).toBe(15);
  });

  // Sem rota o `center` fica de fora: no web ele só vale quando aparece pela
  // primeira vez, e tem que aparecer na origem da rota, não antes.
  it('sem rota e com GPS enquadra a pessoa, sem centro ainda', async () => {
    mockEvac.coords = GPS;
    const tree = await render();
    const mapa = porTestID(tree, 'map-view');

    expect(mapa.props.center).toBeUndefined();
    const [oeste, sul, leste, norte] = mapa.props.bounds;
    expect(GPS[0]).toBeGreaterThan(oeste);
    expect(GPS[0]).toBeLessThan(leste);
    expect(GPS[1]).toBeGreaterThan(sul);
    expect(GPS[1]).toBeLessThan(norte);
  });

  it('sem rota e sem GPS enquadra o Brasil', async () => {
    const tree = await render();
    expect(porTestID(tree, 'map-view').props.bounds).toEqual(BRASIL);
  });
});

describe('Tela de evacuação: rota', () => {
  it.each(['idle', 'loading'] as const)(
    'em %s não desenha linha, chips nem ponto de encontro',
    async (status) => {
      mockEvac.loadStatus = status;
      const tree = await render();

      expect(porTestID(tree, 'line-evacuation-route')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-chip-1')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-chip-2')).toBeUndefined();
      expect(porTestID(tree, 'marker-evacuation-destination')).toBeUndefined();
    },
  );

  it('com a rota pronta manda ao mapa exatamente os waypoints do backend', async () => {
    pronta();
    const tree = await render();

    const linha = porTestID(tree, 'line-evacuation-route');
    expect(linha.props.shape.geometry.type).toBe('LineString');
    expect(linha.props.shape.geometry.coordinates).toEqual(WAYPOINTS);
    expect(linha.props.paint).toEqual({ color: '#8AD2E2', width: 4, opacity: 0.95 });
  });

  // Trava do fim do traçado inventado: a tela antiga desenhava uma reta entre
  // dois pontos fixos quando a rota falhava.
  it.each([
    ['no-evacuation', 'Nenhuma evacuação em andamento com ponto de encontro.'],
    ['no-position', 'Ative a localização para traçar a rota.'],
    ['failed', 'Não foi possível traçar a rota. Siga as orientações do gestor.'],
  ] as const)('erro %s: sem traçado nenhum e com a frase do motivo', async (kind, frase) => {
    mockEvac.loadStatus = 'error';
    mockEvac.errorKind = kind;
    const tree = await render();

    expect(porTestID(tree, 'line-evacuation-route')).toBeUndefined();
    expect(porTestID(tree, 'marker-evacuation-destination')).toBeUndefined();
    expect(porTestID(tree, 'marker-evacuation-chip-1')).toBeUndefined();
    expect(textos(tree)).toContain(frase);
  });

  it('rota aproximada desenha a linha e avisa para seguir o gestor', async () => {
    pronta({ approximate: true });
    const tree = await render();

    expect(porTestID(tree, 'line-evacuation-route')).toBeDefined();
    expect(textos(tree)).toContain('Rota aproximada: siga as orientações do gestor.');
  });

  it('rota normal não mostra aviso', async () => {
    pronta();
    const tree = await render();

    expect(textos(tree).some((t) => t.includes('orientações do gestor'))).toBe(false);
  });
});

describe('Tela de evacuação: chips de tempo ancoradas na rota', () => {
  it('ancora as duas chips a 35% e 70% dos waypoints', async () => {
    pronta();
    const tree = await render();

    expect(porTestID(tree, 'marker-evacuation-chip-1').props.coordinate).toEqual(WAYPOINTS[3]);
    expect(porTestID(tree, 'marker-evacuation-chip-2').props.coordinate).toEqual(WAYPOINTS[7]);
  });

  // Os rótulos eram "6 minutos"/"17 minutos" cravados do mockup; agora saem da
  // duração real, cada um no tempo acumulado até a própria âncora.
  it('deriva cada rótulo da duração real na fração em que a chip ancora', async () => {
    pronta({ durationSec: 1200 }); // 20 min → 35% = 7, 70% = 14
    const tree = await render();

    const t = textos(tree);
    expect(t).toContain('7 minutos');
    expect(t).toContain('14 minutos');
  });

  it('usa o singular quando o trecho arredonda para um minuto', async () => {
    pronta({ durationSec: 100 }); // 35% ≈ 0,6 min → piso de 1
    const tree = await render();

    expect(textos(tree)).toContain('1 minuto');
  });
});

describe('Tela de evacuação: pinos e conteúdo do cartão', () => {
  it('põe o início no GPS e o destino no ponto de encontro da rota', async () => {
    pronta();
    mockEvac.coords = GPS;
    const tree = await render();

    expect(porTestID(tree, 'marker-evacuation-origin').props.coordinate).toEqual(GPS);
    expect(porTestID(tree, 'marker-evacuation-destination').props.coordinate).toEqual(ENCONTRO);
  });

  it('sem GPS o início é a origem que o backend usou (última posição real)', async () => {
    pronta();
    const tree = await render();

    expect(porTestID(tree, 'marker-evacuation-origin').props.coordinate).toEqual(ORIGEM);
  });

  it('sem GPS e sem rota não há pino de início', async () => {
    const tree = await render();
    expect(porTestID(tree, 'marker-evacuation-origin')).toBeUndefined();
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
