import { act, create } from 'react-test-renderer';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import MapaGeral from '../../../app/(app)/map';

// Os aneis de distancia do mapa.
//
// A tela desenhava dois <View> de 395 e 647 PIXELS grudados no centro da tela,
// com "5KM"/"10KM" digitado ao lado. Pixel nao e distancia: em qualquer zoom
// diferente do que o mockup assumiu o rotulo mentia, e arrastar o mapa nao
// movia os aneis, porque eles nunca souberam onde ficava o chao.
//
// Este teste mede os aneis EM METROS, com haversine propria, e trava a
// ausencia dos tamanhos fixos antigos.

const MINA: [number, number] = [-43.9, -19.9];

jest.mock('@/services/location/LocationProvider', () => ({
  useLocation: () => ({ coords: [-43.9, -19.9], permission: 'granted' }),
}));
jest.mock('@/services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: { avatarUrl: '' } }),
}));
jest.mock('@/services/vitals/VitalsProvider', () => ({
  useVitals: () => ({ status: 'good' }),
}));
jest.mock('@/lib/featureFlags', () => ({
  ...jest.requireActual('@/lib/featureFlags'),
  isFeatureEnabled: () => true, // o gate 'maps' so liga em build nativa
}));

// Fronteira do MapLibre dublada: o teste olha o que a tela MANDA pro mapa, nao
// o que o mapa desenha. MapView vira um passa-children; cada filho de mapa vira
// uma View que carrega os proprios props pra inspecao.
jest.mock('@/components/MapView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { MapView: (p: any) => React.createElement(View, null, p.children) };
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
jest.mock('@/components/MapHeatmapSource', () => ({ MapHeatmapSource: () => null }));
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

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SwiThemeProvider>
        <MapaGeral />
      </SwiThemeProvider>,
    );
  });
  return tree;
};

const porTestID = (tree: ReturnType<typeof create>, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

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
