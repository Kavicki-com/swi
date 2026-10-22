import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import MapaGeral from '../../../app/(app)/map';

// O mapa geral aberto pelo "Ver câmera" da ficha do colega: `cameras=1` liga a
// camada de câmeras ao abrir, e `lat`/`lng` centram no colega no lugar da
// posição do aparelho. Sem parâmetro o mapa abre como sempre.

const MINA: [number, number] = [-43.9, -19.9];

let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/services/location/LocationProvider', () => ({
  useLocation: () => ({ coords: [-43.9, -19.9], permission: 'granted' }),
}));
jest.mock('@/services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: { avatarUrl: '' } }),
}));
jest.mock('@/services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => ({ telemetry: null, failed: false, loading: false }),
}));
jest.mock('@/lib/featureFlags', () => ({
  ...jest.requireActual('@/lib/featureFlags'),
  isFeatureEnabled: () => true,
}));
jest.mock('@/services/positions/getPositionsBackend', () => ({
  getPositionsBackend: () => ({
    heartbeat: jest.fn(),
    listColleagues: async () => [],
    heat: async () => ({ cellSizeM: 50, from: '', to: '', cells: [] }),
  }),
}));
const mockListCameras = jest.fn();
jest.mock('@/services/cameras/getCamerasBackend', () => ({
  getCamerasBackend: () => ({ list: () => mockListCameras() }),
}));
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
  return { MapLineSource: (p: any) => React.createElement(View, { testID: `line-${p.id}` }) };
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
  return { MapHeatmapSource: (p: any) => React.createElement(View, { testID: `heat-${p.id}` }) };
});
jest.mock('@/components/NavFABs', () => ({ NavFABs: () => null }));

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

const botaoCameras = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === 'Câmeras' && typeof n.props?.onPress === 'function',
  )[0];

beforeEach(() => {
  jest.useFakeTimers();
  mockParams = {};
  mockListCameras.mockReset().mockResolvedValue([
    { id: 'a', name: 'Câmera a', lat: -23.51, lng: -46.61 },
  ]);
});

afterEach(async () => {
  await act(async () => {
    arvores.forEach((t) => t.unmount());
  });
  arvores = [];
  jest.useRealTimers();
});

describe('Mapa geral: aberto pelo Ver câmera', () => {
  it('cameras=1 abre com a camada de câmeras ligada e os pontos no mapa', async () => {
    mockParams = { cameras: '1' };
    const tree = await render();

    expect(mockListCameras).toHaveBeenCalled();
    expect(porTestID(tree, 'marker-camera-a')).toBeDefined();
    expect(botaoCameras(tree).props.active).toBe(true);
  });

  it('a camada ligada pelo parâmetro desliga no toque, como sempre', async () => {
    mockParams = { cameras: '1' };
    const tree = await render();

    await act(async () => {
      botaoCameras(tree).props.onPress();
    });

    expect(porTestID(tree, 'marker-camera-a')).toBeUndefined();
  });

  it('lat e lng centram no colega, no lugar da posição do aparelho', async () => {
    mockParams = { cameras: '1', lat: '-23.5', lng: '-46.6' };
    const tree = await render();

    expect(porTestID(tree, 'mapview').props.center).toEqual([-46.6, -23.5]);
  });

  it('coordenada que não é número não centra em lugar nenhum inventado', async () => {
    mockParams = { cameras: '1', lat: 'abc', lng: '-46.6' };
    const tree = await render();

    expect(porTestID(tree, 'mapview').props.center).toEqual(MINA);
  });

  it('sem parâmetro, o mapa abre na posição do aparelho e sem câmeras', async () => {
    const tree = await render();

    expect(porTestID(tree, 'mapview').props.center).toEqual(MINA);
    expect(mockListCameras).not.toHaveBeenCalled();
    expect(botaoCameras(tree).props.active).toBe(false);
  });
});
