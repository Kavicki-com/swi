import { act, create } from 'react-test-renderer';
import type { FeatureCollection, Point } from 'geojson';
import { MapInstanceContext, type MapInstanceContextValue } from '../../components/MapView.web';
import { MapHeatmapSource } from '../../components/MapHeatmapSource.web';
import type {
  HeatmapColorStop,
  MapHeatmapSourceProps,
} from '../../components/MapHeatmapSource.types';

// Fonte de calor declarativa do mapa no web (concentração de trabalhadores).
// Como a de linha, o componente não desenha: traduz o props unificado para as
// chamadas imperativas do maplibre. O ponto sensível aqui é a rampa de cores,
// que vira uma expressão de interpolação, e a limpeza, porque um heatmap
// esquecido continuaria pintando gente que já saiu da área.

const criarMapa = () => {
  const camadas = new Set<string>();
  const fontes = new Set<string>();
  return {
    camadas,
    fontes,
    getLayer: jest.fn((id: string) => (camadas.has(id) ? { id } : undefined)),
    getSource: jest.fn((id: string) => (fontes.has(id) ? { id } : undefined)),
    addLayer: jest.fn((layer: { id: string }, _beforeId?: string) => {
      camadas.add(layer.id);
    }),
    removeLayer: jest.fn((id: string) => camadas.delete(id)),
    addSource: jest.fn((id: string) => {
      fontes.add(id);
    }),
    removeSource: jest.fn((id: string) => fontes.delete(id)),
  };
};

type MapaFalso = ReturnType<typeof criarMapa>;

const PONTOS: FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-43.9, -19.9] },
      properties: { weight: 0.7 },
    },
  ],
};

const RAMPA: HeatmapColorStop[] = [
  [0, 'rgba(0,0,0,0)'],
  [1, '#FF5A36'],
];

const props = (over: Partial<MapHeatmapSourceProps> = {}): MapHeatmapSourceProps => ({
  id: 'calor',
  shape: PONTOS,
  paint: { colorStops: RAMPA },
  ...over,
});

const render = async (p: MapHeatmapSourceProps, mapa?: MapaFalso) => {
  // A instância é dependência do efeito: se o valor do contexto for recriado a
  // cada render, a camada reanexa sozinha e os testes de reanexo passariam sem
  // provar nada. Aqui ela é estável, como o MapView real a mantém.
  const instancia = { map: mapa, lib: {} } as unknown as MapInstanceContextValue;

  const conteudo = (atual: MapHeatmapSourceProps) =>
    mapa ? (
      <MapInstanceContext.Provider value={instancia}>
        <MapHeatmapSource {...atual} />
      </MapInstanceContext.Provider>
    ) : (
      <MapHeatmapSource {...atual} />
    );

  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(conteudo(p));
  });

  return {
    tree,
    atualizar: async (novos: MapHeatmapSourceProps) => {
      await act(async () => {
        tree.update(conteudo(novos));
      });
    },
    desmontar: async () => {
      await act(async () => {
        tree.unmount();
      });
    },
  };
};

type CamadaAnexada = {
  id: string;
  type: string;
  source: string;
  paint: Record<string, unknown>;
};

const camadaAdicionada = (mapa: MapaFalso, i = 0) =>
  mapa.addLayer.mock.calls[i][0] as unknown as CamadaAnexada;

const fonteAdicionada = (mapa: MapaFalso) =>
  mapa.addSource.mock.calls[0] as unknown as [string, { type: string; data: unknown }];

describe('MapHeatmapSource no web: o que vai para o mapa', () => {
  it('sem mapa disponível ainda, não tenta anexar nada', async () => {
    const { tree } = await render(props());

    expect(tree.toJSON()).toBeNull();
  });

  it('registra a fonte com os pontos crus e a camada de calor derivada do id', async () => {
    const mapa = criarMapa();
    await render(props(), mapa);

    expect(fonteAdicionada(mapa)[0]).toBe('calor');
    expect(fonteAdicionada(mapa)[1]).toEqual({ type: 'geojson', data: PONTOS });
    expect(camadaAdicionada(mapa)).toMatchObject({
      id: 'calor-layer',
      type: 'heatmap',
      source: 'calor',
    });
  });

  // A rampa é a parte que o chamador não deveria ter que escrever à mão; o
  // componente monta a expressão de interpolação a partir dos pares.
  it('transforma as paradas de cor na expressão de interpolação do maplibre', async () => {
    const mapa = criarMapa();
    await render(props(), mapa);

    expect(camadaAdicionada(mapa).paint['heatmap-color']).toEqual([
      'interpolate',
      ['linear'],
      ['heatmap-density'],
      0,
      'rgba(0,0,0,0)',
      1,
      '#FF5A36',
    ]);
  });

  it('sem intensidade, raio ou opacidade declarados, usa os padrões do componente', async () => {
    const mapa = criarMapa();
    await render(props(), mapa);

    expect(camadaAdicionada(mapa).paint).toMatchObject({
      'heatmap-intensity': 1,
      'heatmap-radius': 30,
      'heatmap-opacity': 1,
    });
  });

  it('intensidade, raio e opacidade declarados chegam como pedidos', async () => {
    const mapa = criarMapa();
    await render(
      props({ paint: { colorStops: RAMPA, intensity: 2, radius: 45, opacity: 0.6 } }),
      mapa,
    );

    expect(camadaAdicionada(mapa).paint).toMatchObject({
      'heatmap-intensity': 2,
      'heatmap-radius': 45,
      'heatmap-opacity': 0.6,
    });
  });

  // Sem propriedade de peso todo ponto pesa igual; com ela o peso sai de cada
  // ponto, que é o que diferencia aglomeração de gente espalhada.
  it('sem propriedade de peso, todo ponto pesa igual', async () => {
    const mapa = criarMapa();
    await render(props(), mapa);

    expect(camadaAdicionada(mapa).paint['heatmap-weight']).toBe(1);
  });

  it('com propriedade de peso, o peso é lido de cada ponto', async () => {
    const mapa = criarMapa();
    await render(props({ paint: { colorStops: RAMPA, weightProperty: 'weight' } }), mapa);

    expect(camadaAdicionada(mapa).paint['heatmap-weight']).toEqual(['get', 'weight']);
  });

  it('insere a camada abaixo da indicada quando o chamador pede', async () => {
    const mapa = criarMapa();
    await render(props({ beforeId: 'marcadores' }), mapa);

    expect(mapa.addLayer.mock.calls[0][1]).toBe('marcadores');
  });
});

describe('MapHeatmapSource no web: limpeza e reanexo', () => {
  it('ao sair da tela, tira a camada e a fonte do mapa', async () => {
    const mapa = criarMapa();
    const { desmontar } = await render(props(), mapa);

    await desmontar();

    expect(mapa.removeLayer).toHaveBeenCalledWith('calor-layer');
    expect(mapa.removeSource).toHaveBeenCalledWith('calor');
  });

  it('camada e fonte já existentes são derrubadas antes de anexar de novo', async () => {
    const mapa = criarMapa();
    mapa.camadas.add('calor-layer');
    mapa.fontes.add('calor');

    await render(props(), mapa);

    expect(mapa.removeLayer).toHaveBeenCalledWith('calor-layer');
    expect(mapa.removeSource).toHaveBeenCalledWith('calor');
    expect(mapa.addLayer).toHaveBeenCalledTimes(1);
  });

  it('mapa limpo não recebe remoção do que não existe', async () => {
    const mapa = criarMapa();
    await render(props(), mapa);

    expect(mapa.removeLayer).not.toHaveBeenCalled();
    expect(mapa.removeSource).not.toHaveBeenCalled();
  });

  it('pontos novos reanexam a camada com os dados atualizados', async () => {
    const mapa = criarMapa();
    const { atualizar } = await render(props(), mapa);
    const outros: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };

    await atualizar(props({ shape: outros }));

    expect(mapa.addLayer).toHaveBeenCalledTimes(2);
    const segundaFonte = mapa.addSource.mock.calls[1] as unknown as [string, { data: unknown }];
    expect(segundaFonte[1]).toEqual({ type: 'geojson', data: outros });
  });

  // A rampa é o único valor profundo do paint. Repassar a MESMA lista não pode
  // reanexar a camada a cada render do mapa; é para isso que existe o memo.
  it('a mesma rampa de cores entre renders não reanexa a camada', async () => {
    const mapa = criarMapa();
    const { atualizar } = await render(props(), mapa);

    await atualizar(props());

    expect(mapa.addLayer).toHaveBeenCalledTimes(1);
  });

  // Comportamento nomeado, não corrigido: a memoização compara a IDENTIDADE da
  // lista, então uma rampa recriada a cada render com o mesmo conteúdo reanexa
  // a camada. Quem chama precisa manter a lista estável.
  it('rampa recriada com o mesmo conteúdo ainda reanexa a camada', async () => {
    const mapa = criarMapa();
    const { atualizar } = await render(props(), mapa);

    await atualizar(props({ paint: { colorStops: [...RAMPA] } }));

    expect(mapa.addLayer).toHaveBeenCalledTimes(2);
  });
});
