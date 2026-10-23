import { act, create } from 'react-test-renderer';
import { View } from 'react-native';
import { MapMarker } from '../../components/MapMarker.native';

// Marcador nativo do mapa. A ordem de empilhamento entre marcadores não segue
// a ordem do JSX: no Android cada um entra por cima dos anteriores na hora em
// que é ligado ao mapa, e no iPhone a biblioteca empilha pela latitude. A seta
// "você está aqui" passava por baixo dos selos de tempo por isso. O `zIndex`
// vai no estilo do Marker, que a biblioteca leva às duas plataformas.

jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View: RNView } = require('react-native');
  return {
    Marker: (p: any) => React.createElement(RNView, { ...p, testID: 'marker-nativo' }),
    Map: () => null,
    Camera: () => null,
  };
});

const render = async (zIndex?: number) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <MapMarker id="seta" coordinate={[-43.9, -19.9]} zIndex={zIndex}>
        <View />
      </MapMarker>,
    );
  });
  return tree.root.findAll((n) => n.props?.testID === 'marker-nativo')[0];
};

describe('MapMarker (nativo)', () => {
  it('repassa id e posição', async () => {
    const marcador = await render();
    expect(marcador.props.id).toBe('seta');
    expect(marcador.props.lngLat).toEqual([-43.9, -19.9]);
  });

  it('com zIndex, leva a ordem de empilhamento no estilo do Marker', async () => {
    const marcador = await render(1000);
    expect(marcador.props.style).toEqual({ zIndex: 1000 });
  });

  it('sem zIndex, não mexe no empilhamento', async () => {
    const marcador = await render();
    expect(marcador.props.style).toBeUndefined();
  });
});
