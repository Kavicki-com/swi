import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import MapWeather from '../../../app/(app)/map-weather';
import { USER_LOCATION } from '../../../lib/mapMockData';

// Tela de clima do mapa. O teste olha o que a tela MANDA para o mapa, nunca o
// que o mapa desenha: a fronteira do MapLibre e dublada igual em map.test.tsx.
//
// Tres comportamentos aqui nao sao cosmeticos e por isso viram trava:
//
// 1. O defer de 300ms do heatmap (Fix 9 do cliente). Montar as duas camadas de
//    calor no mesmo frame da inicializacao do GL derrubava o libmaplibre.so em
//    GPUs Android mid-range. Se alguem trocar o setTimeout por um estado
//    inicial `true`, o crash volta em campo e nao no CI, entao o teste afirma o
//    frame de montagem VAZIO e a limpeza do timer no desmonte.
// 2. O centro sai do GPS do provider, nao da constante de demo. As duas telas
//    de mapa divergiam e o clima abria em Sao Paulo para quem estava em
//    Curitiba (QA 2026-07-26).
// 3. Os numeros de paint reduzidos pela metade no Fix 9. Sao a diferenca entre
//    rodar e estourar a alocacao de textura.

const GPS: [number, number] = [-49.27, -25.43]; // Curitiba, longe da constante

// --- Fronteiras dubladas -----------------------------------------------------

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('../../../services/location/LocationProvider', () => ({
  useLocation: () => ({ coords: [-49.27, -25.43], permission: 'granted' }),
}));

// O gate 'maps' so liga em build nativa; aqui ele e um botao do teste.
let mockMapsLigado = true;
jest.mock('../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../lib/featureFlags'),
  isFeatureEnabled: (gate: string) => (gate === 'maps' ? mockMapsLigado : true),
}));

jest.mock('../../../components/MapView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MapView: (p: any) =>
      React.createElement(View, { testID: 'mapview', center: p.center, zoom: p.zoom }, p.children),
  };
});
jest.mock('../../../components/MapMarker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MapMarker: (p: any) =>
      React.createElement(View, { testID: `marker-${p.id}`, coordinate: p.coordinate }, p.children),
  };
});
jest.mock('../../../components/MapHeatmapSource', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MapHeatmapSource: (p: any) =>
      React.createElement(View, { testID: `heat-${p.id}`, shape: p.shape, paint: p.paint }),
  };
});
jest.mock('../../../components/NavFABs', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    NavFABs: (p: any) => React.createElement(View, { testID: 'navfabs', showChat: p.showChat }),
  };
});

// --- Helpers -----------------------------------------------------------------

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const montar = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <MapWeather />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// Monta e deixa o defer de 300ms passar: estado normal da tela em uso.
const montarPronto = async () => {
  const tree = await montar();
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  return tree;
};

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

const porTestID = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

const porRotulo = (tree: ReactTestRenderer, rotulo: string) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === rotulo && typeof n.props?.onPress === 'function',
  )[0];

// O rotulo aparece duas vezes na arvore: no MapToggleButton e no Pressable que
// ele renderiza. Quem anuncia o estado para o leitor de tela e o segundo.
const estadoDoBotao = (tree: ReactTestRenderer, rotulo: string) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === rotulo && n.props?.accessibilityState !== undefined,
  )[0].props.accessibilityState.selected as boolean;

const tocar = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onPress();
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockMapsLigado = true;
});

afterEach(() => {
  jest.useRealTimers();
});

// --- Gate --------------------------------------------------------------------

describe('Mapa do clima: gate de build', () => {
  it('troca a tela inteira pelo placeholder quando o gate maps esta desligado', async () => {
    mockMapsLigado = false;
    const tree = await montar();

    expect(porTestID(tree, 'mapview')).toBeUndefined();
    expect(idsCom(tree, 'marker-')).toHaveLength(0);
  });
});

// --- Defer do heatmap (Fix 9) ------------------------------------------------

describe('Mapa do clima: defer do heatmap (Fix 9 do cliente)', () => {
  it('nao monta camada de calor alguma no frame da montagem', async () => {
    const tree = await montar();

    expect(porTestID(tree, 'mapview')).toBeDefined();
    expect(idsCom(tree, 'heat-')).toHaveLength(0);
  });

  it('monta tempestade e inundacao juntas 300ms depois', async () => {
    const tree = await montar();

    await act(async () => {
      jest.advanceTimersByTime(299);
    });
    expect(idsCom(tree, 'heat-')).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(idsCom(tree, 'heat-').sort()).toEqual(['heat-flood-heatmap', 'heat-storm-heatmap']);
  });

  it('cancela o timer pendente quando a tela sai antes dos 300ms', async () => {
    // A contagem global de timers nao serve de prova: a arvore agenda outros.
    // Este teste segue o id do defer, do agendamento ate o cancelamento.
    const agendar = jest.spyOn(globalThis, 'setTimeout');
    const cancelar = jest.spyOn(globalThis, 'clearTimeout');

    const tree = await montar();
    const idsDoDefer = agendar.mock.calls
      .map((args, i) => (args[1] === 300 ? agendar.mock.results[i].value : undefined))
      .filter((v) => v !== undefined);
    expect(idsDoDefer).toHaveLength(1);

    await act(async () => {
      tree.unmount();
    });

    // Sem o clearTimeout, o timer sobrevive a tela e dispara setState no vazio.
    expect(cancelar).toHaveBeenCalledWith(idsDoDefer[0]);

    agendar.mockRestore();
    cancelar.mockRestore();
  });
});

// --- Centro ------------------------------------------------------------------

describe('Mapa do clima: centro', () => {
  it('centra no GPS do provider, nao na constante de demo (QA 2026-07-26)', async () => {
    const tree = await montarPronto();
    const mapa = porTestID(tree, 'mapview');

    expect(mapa.props.center).toEqual(GPS);
    expect(mapa.props.center).not.toEqual(USER_LOCATION);
    expect(mapa.props.zoom).toBe(13);
  });

  it('mantem os pontos de calor ancorados na constante de demo, longe do GPS', async () => {
    const tree = await montarPronto();
    const storm = porTestID(tree, 'heat-storm-heatmap');
    const [lng, lat] = storm.props.shape.features[0].geometry.coordinates as [number, number];

    // Dado de clima fabricado, nao posicao do usuario: fica onde a demo manda.
    expect(lng).toBeCloseTo(USER_LOCATION[0], 1);
    expect(lat).toBeCloseTo(USER_LOCATION[1], 1);
  });
});

// --- Pinos de alerta ---------------------------------------------------------

describe('Mapa do clima: pinos de alerta', () => {
  it('desenha os 11 pinos sem depender de toggle algum', async () => {
    const tree = await montar(); // antes mesmo do defer

    expect(idsCom(tree, 'marker-alert-')).toHaveLength(11);
  });

  it('tocar em qualquer pino abre o modal do alerta meteorologico', async () => {
    const tree = await montarPronto();
    const pino = tree.root.findAll(
      (n) =>
        typeof n.props?.accessibilityLabel === 'string' &&
        n.props.accessibilityLabel.startsWith('Alerta ') &&
        typeof n.props?.onPress === 'function',
    )[0];

    await tocar(pino);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/modals/weather-alert');
  });
});

// --- Toggles -----------------------------------------------------------------

describe('Mapa do clima: toggles dos overlays', () => {
  it('operadores comecam escondidos, aparecem no primeiro toque e somem no segundo', async () => {
    const tree = await montarPronto();
    expect(idsCom(tree, 'marker-worker-')).toHaveLength(0);

    await tocar(porRotulo(tree, 'Operadores'));
    expect(idsCom(tree, 'marker-worker-')).toHaveLength(7);

    await tocar(porRotulo(tree, 'Operadores'));
    expect(idsCom(tree, 'marker-worker-')).toHaveLength(0);
  });

  it('cameras comecam escondidas, aparecem no primeiro toque e somem no segundo', async () => {
    const tree = await montarPronto();
    expect(idsCom(tree, 'marker-camera-')).toHaveLength(0);

    await tocar(porRotulo(tree, 'Câmeras'));
    expect(idsCom(tree, 'marker-camera-')).toHaveLength(12);

    await tocar(porRotulo(tree, 'Câmeras'));
    expect(idsCom(tree, 'marker-camera-')).toHaveLength(0);
  });

  it('o botao do heatmap desliga as DUAS camadas de uma vez e devolve as duas', async () => {
    const tree = await montarPronto();
    expect(idsCom(tree, 'heat-')).toHaveLength(2);

    await tocar(porRotulo(tree, 'Heatmap'));
    expect(idsCom(tree, 'heat-')).toHaveLength(0);

    await tocar(porRotulo(tree, 'Heatmap'));
    expect(idsCom(tree, 'heat-')).toHaveLength(2);
  });

  it('cada botao anuncia o proprio estado, sem contaminar os vizinhos', async () => {
    const tree = await montarPronto();
    const estado = (rotulo: string) => estadoDoBotao(tree, rotulo);

    expect(estado('Operadores')).toBe(false);
    expect(estado('Heatmap')).toBe(true); // ligado pelo defer
    expect(estado('Câmeras')).toBe(false);

    await tocar(porRotulo(tree, 'Operadores'));

    expect(estado('Operadores')).toBe(true);
    expect(estado('Heatmap')).toBe(true);
    expect(estado('Câmeras')).toBe(false);
  });
});

// --- Dados das camadas de calor ----------------------------------------------

describe('Mapa do clima: dados das camadas de calor', () => {
  it('tempestade tem 250 pontos e inundacao 150 (contagens do Fix 9)', async () => {
    const tree = await montarPronto();

    expect(porTestID(tree, 'heat-storm-heatmap').props.shape.features).toHaveLength(250);
    expect(porTestID(tree, 'heat-flood-heatmap').props.shape.features).toHaveLength(150);
  });

  it('todo ponto sai com peso dentro da faixa que a rampa de cor entende', async () => {
    const tree = await montarPronto();

    for (const id of ['heat-storm-heatmap', 'heat-flood-heatmap']) {
      const features = porTestID(tree, id).props.shape.features as {
        properties: { weight: number };
        geometry: { coordinates: [number, number] };
      }[];
      for (const f of features) {
        expect(f.properties.weight).toBeGreaterThanOrEqual(0.2);
        expect(f.properties.weight).toBeLessThanOrEqual(1);
        expect(Number.isFinite(f.geometry.coordinates[0])).toBe(true);
        expect(Number.isFinite(f.geometry.coordinates[1])).toBe(true);
      }
    }
  });

  it('o cluster de inundacao nasce deslocado do de tempestade, para os dois nao virarem um so', async () => {
    const tree = await montarPronto();
    const media = (id: string, eixo: 0 | 1) => {
      const fs = porTestID(tree, id).props.shape.features as {
        geometry: { coordinates: [number, number] };
      }[];
      return fs.reduce((s, f) => s + f.geometry.coordinates[eixo], 0) / fs.length;
    };

    // Centro da inundacao: +0.004 em longitude, -0.008 em latitude.
    expect(media('heat-flood-heatmap', 0)).toBeGreaterThan(media('heat-storm-heatmap', 0));
    expect(media('heat-flood-heatmap', 1)).toBeLessThan(media('heat-storm-heatmap', 1));
  });

  it('a distribuicao nao e re-sorteada quando outro overlay liga', async () => {
    const tree = await montarPronto();
    const antes = porTestID(tree, 'heat-storm-heatmap').props.shape;

    await tocar(porRotulo(tree, 'Operadores'));

    expect(porTestID(tree, 'heat-storm-heatmap').props.shape).toBe(antes);
  });

  it('trava a intensidade, o raio e a opacidade reduzidos no Fix 9', async () => {
    const tree = await montarPronto();

    expect(porTestID(tree, 'heat-storm-heatmap').props.paint).toMatchObject({
      intensity: 2.0,
      radius: 70,
      opacity: 0.82,
      weightProperty: 'weight',
    });
    expect(porTestID(tree, 'heat-flood-heatmap').props.paint).toMatchObject({
      intensity: 1.6,
      radius: 55,
      opacity: 0.78,
      weightProperty: 'weight',
    });
  });

  it('as duas rampas sobem de zero a um sem repetir parada e terminam no mesmo magenta', async () => {
    const tree = await montarPronto();

    for (const id of ['heat-storm-heatmap', 'heat-flood-heatmap']) {
      const stops = porTestID(tree, id).props.paint.colorStops as [number, string][];
      const posicoes = stops.map(([p]) => p);

      expect(posicoes[0]).toBe(0);
      expect(posicoes[posicoes.length - 1]).toBe(1);
      expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
      expect(new Set(posicoes).size).toBe(posicoes.length);
      expect(stops[0][1]).toContain('rgba('); // primeira parada transparente
      expect(stops[stops.length - 1][1]).toBe('rgb(159,18,57)');
    }
  });
});

// --- Box-Muller --------------------------------------------------------------

describe('Mapa do clima: geracao dos pontos', () => {
  // Oraculo independente: com sorteio fixo em 0.5 a transformada colapsa num
  // unico ponto, e da para conferir o raio e o peso pela formula, na mao.
  it('com sorteio fixo, o deslocamento e o peso saem da formula de Box-Muller', async () => {
    const sorteio = jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const tree = await montarPronto();
    const storm = porTestID(tree, 'heat-storm-heatmap').props.shape;

    const spreadDoNucleo = 0.006;
    const r = Math.sqrt(-2 * Math.log(0.5)) * spreadDoNucleo; // u = 1 - 0.5
    const pesoEsperado = 1 - r / (spreadDoNucleo * 2.4); // theta = PI, distancia = r

    const [lng, lat] = storm.features[0].geometry.coordinates as [number, number];
    expect(lng).toBeCloseTo(USER_LOCATION[0] - r, 10); // cos(PI) = -1
    expect(lat).toBeCloseTo(USER_LOCATION[1], 10); // sin(PI) = 0
    expect(storm.features[0].properties.weight).toBeCloseTo(pesoEsperado, 10);

    // Halo: mesmo sorteio, spread maior, entao cai mais longe que o nucleo.
    const [lngHalo] = storm.features[249].geometry.coordinates as [number, number];
    expect(Math.abs(lngHalo - USER_LOCATION[0])).toBeGreaterThan(Math.abs(lng - USER_LOCATION[0]));

    sorteio.mockRestore();
  });
});

// --- FABs --------------------------------------------------------------------

describe('Mapa do clima: navegacao flutuante', () => {
  it('nao oferece o FAB de chat nesta variante (Figma 385:29139)', async () => {
    const tree = await montarPronto();

    expect(porTestID(tree, 'navfabs').props.showChat).toBe(false);
  });
});
