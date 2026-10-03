import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import MapWeather from '../../../app/(app)/map-weather';

// Tela de clima do mapa. O teste olha o que a tela MANDA para o mapa, nunca o
// que o mapa desenha: a fronteira do MapLibre e dublada igual em map.test.tsx.
//
// O que vira trava aqui:
//
// 1. A chuva e observacao real (radar IMERG do NASA GIBS), nunca mancha
//    sorteada. A tela ja desenhou tempestade e inundacao com Math.random em
//    volta de um ponto fixo de Sao Paulo.
// 2. O radar chega com horas de atraso, entao a camada so aparece junto da
//    hora da observacao. Sem leitura, nao ha camada e a tela diz que o radar
//    esta indisponivel.
// 3. O defer de 300ms da camada (Fix 9 do cliente). Montar camada no mesmo
//    frame da inicializacao do GL derrubava o libmaplibre.so em GPUs Android
//    mid-range; o crash volta em campo e nao no CI, entao o teste afirma o
//    frame de montagem VAZIO e a limpeza do timer no desmonte.
// 4. Sem GPS nao existe ponto de reserva: o mapa abre nos colegas ou no Brasil.

const GPS: [number, number] = [-49.27, -25.43]; // Curitiba
const BRASIL = [-73.99, -33.75, -34.79, 5.27];
const OBSERVACAO = '2026-10-03T11:30:00Z';
const TILES_GIBS =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default/';

// --- Fronteiras dubladas -----------------------------------------------------

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

let mockCoords: [number, number] | null = [-49.27, -25.43];
jest.mock('../../../services/location/LocationProvider', () => ({
  useLocation: () => ({ coords: mockCoords, permission: 'granted' }),
}));

const mockListColleagues = jest.fn();
jest.mock('../../../services/positions/getPositionsBackend', () => ({
  getPositionsBackend: () => ({
    heartbeat: jest.fn(),
    listColleagues: () => mockListColleagues(),
    heat: jest.fn(),
  }),
}));

// So a consulta ao GIBS e dublada; o molde dos tiles e o texto da hora sao os
// de verdade.
const mockRadarTime = jest.fn();
jest.mock('../../../services/weather/rainRadar', () => ({
  ...jest.requireActual('../../../services/weather/rainRadar'),
  latestRainRadarTime: () => mockRadarTime(),
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
      React.createElement(
        View,
        { testID: 'mapview', center: p.center, bounds: p.bounds, zoom: p.zoom },
        p.children,
      ),
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
jest.mock('../../../components/MapRasterSource', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MapRasterSource: (p: any) => React.createElement(View, { testID: `raster-${p.id}`, ...p }),
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

const colega = (id: string, lng: number, lat: number, status = 'good') => ({
  id,
  name: `Colega ${id}`,
  lat,
  lng,
  sector: null,
  avatar: `https://fotos.exemplo/${id}.jpg`,
  recordedAt: '2026-10-03T12:00:00.000Z',
  status,
});

let arvores: ReactTestRenderer[] = [];
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
  arvores.push(tree);
  return tree;
};

const avancar = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

// Monta e deixa o defer de 300ms passar: estado normal da tela em uso.
const montarPronto = async () => {
  const tree = await montar();
  await avancar(300);
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

const textos = (tree: ReactTestRenderer) =>
  Array.from(
    new Set(
      tree.root
        .findAll((n) => typeof n.props?.children === 'string')
        .map((n) => n.props.children as string),
    ),
  );

const HORA_DA_CHUVA = /^Chuva observada (às|em \d{2}\/\d{2} às) \d{2}h\d{2}$/;

// O id da fonte leva o horario da observacao, entao so pode haver uma por vez.
const RADAR = `raster-rain-radar-${OBSERVACAO}`;
const radarDe = (tree: ReactTestRenderer) => {
  const ids = idsCom(tree, 'raster-rain-radar-');
  expect(ids).toHaveLength(1);
  return porTestID(tree, ids[0]);
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockMapsLigado = true;
  mockCoords = [-49.27, -25.43];
  mockListColleagues.mockReset().mockResolvedValue([]);
  mockRadarTime.mockReset().mockResolvedValue(OBSERVACAO);
});

afterEach(async () => {
  await act(async () => {
    arvores.forEach((t) => t.unmount());
  });
  arvores = [];
  jest.useRealTimers();
});

// --- Gate --------------------------------------------------------------------

describe('Mapa do clima: gate de build', () => {
  it('troca a tela inteira pelo placeholder quando o gate maps esta desligado', async () => {
    mockMapsLigado = false;
    const tree = await montar();

    expect(porTestID(tree, 'mapview')).toBeUndefined();
    expect(idsCom(tree, 'marker-')).toHaveLength(0);
    expect(mockRadarTime).not.toHaveBeenCalled();
  });
});

// --- Defer do radar (Fix 9) --------------------------------------------------

describe('Mapa do clima: defer da camada (Fix 9 do cliente)', () => {
  it('nao monta camada nem consulta o radar no frame da montagem', async () => {
    const tree = await montar();

    expect(porTestID(tree, 'mapview')).toBeDefined();
    expect(idsCom(tree, 'raster-')).toHaveLength(0);
    expect(mockRadarTime).not.toHaveBeenCalled();
  });

  it('monta o radar 300ms depois', async () => {
    const tree = await montar();

    await avancar(299);
    expect(idsCom(tree, 'raster-')).toHaveLength(0);

    await avancar(1);
    expect(idsCom(tree, 'raster-')).toEqual([RADAR]);
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

// --- Radar de chuva ----------------------------------------------------------

describe('Mapa do clima: radar de chuva', () => {
  it('desenha os tiles do IMERG no horario da observacao lida', async () => {
    const tree = await montarPronto();
    const radar = radarDe(tree);

    expect(radar.props.tiles).toEqual([
      `${TILES_GIBS}${OBSERVACAO}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    ]);
    expect(radar.props.tileSize).toBe(256);
    expect(radar.props.maxzoom).toBe(6);
    expect(radar.props.opacity).toBeGreaterThan(0);
    expect(radar.props.opacity).toBeLessThan(1); // o satelite segue visivel por baixo
  });

  it('nao existe mais camada de calor de clima, e nada e sorteado', async () => {
    const sorteio = jest.spyOn(Math, 'random');
    const tree = await montarPronto();

    expect(idsCom(tree, 'heat-')).toHaveLength(0);
    expect(sorteio).not.toHaveBeenCalled();
    sorteio.mockRestore();
  });

  it('a camada vem acompanhada da hora da observacao', async () => {
    const tree = await montarPronto();

    expect(textos(tree).filter((t) => HORA_DA_CHUVA.test(t))).toHaveLength(1);
  });

  it('sem leitura do radar nao ha camada, e a tela diz que ele esta indisponivel', async () => {
    mockRadarTime.mockRejectedValue(new Error('GIBS fora do ar'));
    const tree = await montarPronto();

    expect(idsCom(tree, 'raster-')).toHaveLength(0);
    expect(textos(tree)).toContain('Radar de chuva indisponível');
    expect(textos(tree).some((t) => HORA_DA_CHUVA.test(t))).toBe(false);
  });

  it('depois de uma falha, tenta de novo em um minuto, sem esperar a meia hora', async () => {
    mockRadarTime.mockRejectedValueOnce(new Error('GIBS fora do ar')).mockResolvedValue(OBSERVACAO);
    const tree = await montarPronto();
    expect(idsCom(tree, 'raster-')).toHaveLength(0);

    await avancar(60_000);

    expect(idsCom(tree, 'raster-')).toEqual([RADAR]);
    expect(textos(tree)).not.toContain('Radar de chuva indisponível');
  });

  it('enquanto a primeira leitura nao chega, nao mostra camada nem texto', async () => {
    mockRadarTime.mockReturnValue(new Promise(() => {}));
    const tree = await montarPronto();

    expect(idsCom(tree, 'raster-')).toHaveLength(0);
    expect(textos(tree).some((t) => t.includes('Chuva') || t.includes('Radar'))).toBe(false);
  });

  it('rele a cada 30 minutos e troca os tiles quando sai observacao nova', async () => {
    const tree = await montarPronto();
    expect(mockRadarTime).toHaveBeenCalledTimes(1);

    mockRadarTime.mockResolvedValue('2026-10-03T12:00:00Z');
    await avancar(30 * 60_000);

    expect(mockRadarTime).toHaveBeenCalledTimes(2);
    // Fonte nova, com id novo: a da observacao anterior saiu.
    expect(idsCom(tree, 'raster-')).toEqual(['raster-rain-radar-2026-10-03T12:00:00Z']);
    expect(radarDe(tree).props.tiles[0]).toContain('2026-10-03T12:00:00Z');
  });

  it('se a releitura falha, a ultima observacao segue na tela com a hora dela', async () => {
    const tree = await montarPronto();

    mockRadarTime.mockRejectedValue(new Error('sem rede'));
    await avancar(30 * 60_000);

    expect(radarDe(tree).props.tiles[0]).toContain(OBSERVACAO);
    expect(textos(tree).filter((t) => HORA_DA_CHUVA.test(t))).toHaveLength(1);
    expect(textos(tree)).not.toContain('Radar de chuva indisponível');
  });

  it('o botao desliga a camada junto com a hora, e religar le de novo', async () => {
    const tree = await montarPronto();

    await tocar(porRotulo(tree, 'Radar de chuva'));
    expect(idsCom(tree, 'raster-')).toHaveLength(0);
    expect(textos(tree).some((t) => HORA_DA_CHUVA.test(t))).toBe(false);

    await tocar(porRotulo(tree, 'Radar de chuva'));
    expect(idsCom(tree, 'raster-')).toEqual([RADAR]);
    expect(mockRadarTime).toHaveBeenCalledTimes(2);
  });
});

// --- Enquadramento -----------------------------------------------------------

describe('Mapa do clima: enquadramento', () => {
  it('centra no GPS do provider, em zoom regional', async () => {
    const tree = await montarPronto();
    const mapa = porTestID(tree, 'mapview');

    expect(mapa.props.center).toEqual(GPS);
    expect(mapa.props.bounds).toBeUndefined();
    // No zoom de rua a tela inteira cabe num quadrado do radar (cerca de 10 km).
    expect(mapa.props.zoom).toBe(7);
  });

  it('sem GPS e sem colegas, enquadra o Brasil em vez de um ponto de reserva', async () => {
    mockCoords = null;
    const tree = await montarPronto();
    const mapa = porTestID(tree, 'mapview');

    expect(mapa.props.center).toBeUndefined();
    expect(mapa.props.bounds).toEqual(BRASIL);
  });

  it('sem GPS e com colegas, centra onde eles estao sem fechar o zoom neles', async () => {
    mockCoords = null;
    mockListColleagues.mockResolvedValue([colega('a', -48.6, -27.7), colega('b', -48.4, -27.5)]);
    const tree = await montarPronto();
    const mapa = porTestID(tree, 'mapview');

    expect(mapa.props.bounds).toBeUndefined();
    expect(mapa.props.center[0]).toBeCloseTo(-48.5, 6);
    expect(mapa.props.center[1]).toBeCloseTo(-27.6, 6);
    expect(mapa.props.zoom).toBe(7);
  });
});

// --- Pinos de alerta ---------------------------------------------------------

describe('Mapa do clima: pinos de alerta', () => {
  // Os 11 pinos eram posicoes fixas escritas a mao, sem alerta nenhum por tras,
  // e todos abriam a janela "Local em Alerta!". Sairam: o mapa nao aponta risco
  // onde ninguem mediu.
  it('nao desenha pino de alerta algum, nem antes nem depois do defer', async () => {
    const tree = await montar();
    expect(idsCom(tree, 'marker-alert-')).toHaveLength(0);

    await avancar(300);
    expect(idsCom(tree, 'marker-alert-')).toHaveLength(0);
    expect(idsCom(tree, 'marker-')).toHaveLength(0);
  });

  it('nada na tela leva a janela do alerta meteorologico', async () => {
    const tree = await montarPronto();

    for (const rotulo of ['Operadores', 'Radar de chuva', 'Câmeras']) {
      await tocar(porRotulo(tree, rotulo));
    }

    expect(mockPush).not.toHaveBeenCalled();
  });
});

// --- Toggles -----------------------------------------------------------------

describe('Mapa do clima: toggles dos overlays', () => {
  it('operadores sao os colegas do backend: aparecem no primeiro toque e somem no segundo', async () => {
    mockListColleagues.mockResolvedValue([
      colega('a', -49.3, -25.4),
      colega('b', -49.2, -25.5, 'unknown'),
    ]);
    const tree = await montarPronto();
    expect(idsCom(tree, 'marker-worker-')).toHaveLength(0);
    expect(mockListColleagues).not.toHaveBeenCalled();

    await tocar(porRotulo(tree, 'Operadores'));
    expect(idsCom(tree, 'marker-worker-').sort()).toEqual(['marker-worker-a', 'marker-worker-b']);
    expect(porTestID(tree, 'marker-worker-a').props.coordinate).toEqual([-49.3, -25.4]);
    const pino = (id: string) =>
      porTestID(tree, id).findAll((n) => n.props?.variant === 'avatar')[0].props;
    expect(pino('marker-worker-a')).toMatchObject({ name: 'Colega a', status: 'good' });
    expect(pino('marker-worker-b').status).toBe('offline'); // sem leitura de saude

    await tocar(porRotulo(tree, 'Operadores'));
    expect(idsCom(tree, 'marker-worker-')).toHaveLength(0);
  });

  it('sem colega no backend, o botao liga e o mapa fica sem ninguem', async () => {
    const tree = await montarPronto();

    await tocar(porRotulo(tree, 'Operadores'));

    expect(mockListColleagues).toHaveBeenCalledTimes(1);
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

  it('cada botao anuncia o proprio estado, sem contaminar os vizinhos', async () => {
    const tree = await montarPronto();
    const estado = (rotulo: string) => estadoDoBotao(tree, rotulo);

    expect(estado('Operadores')).toBe(false);
    expect(estado('Radar de chuva')).toBe(true); // ligado pelo defer
    expect(estado('Câmeras')).toBe(false);

    await tocar(porRotulo(tree, 'Operadores'));

    expect(estado('Operadores')).toBe(true);
    expect(estado('Radar de chuva')).toBe(true);
    expect(estado('Câmeras')).toBe(false);
  });
});

// --- FABs --------------------------------------------------------------------

describe('Mapa do clima: navegacao flutuante', () => {
  it('nao oferece o FAB de chat nesta variante (Figma 385:29139)', async () => {
    const tree = await montarPronto();

    expect(porTestID(tree, 'navfabs').props.showChat).toBe(false);
  });
});
