import { act, create } from 'react-test-renderer';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import { MapInstanceContext, type MapInstanceContextValue } from '../../components/MapView.web';
import { MapLineSource } from '../../components/MapLineSource.web';
import type { MapLineSourceProps } from '../../components/MapLineSource.types';

// Fonte de linha declarativa do mapa no web (rota de evacuação, anéis de
// distância). O componente não desenha nada: ele traduz um props unificado
// para as chamadas imperativas do maplibre-gl. Então o que estes testes medem
// é exatamente o que o componente MANDA para o mapa, incluindo a limpeza, que
// é onde uma linha esquecida ficaria empilhada sobre a próxima rota.

// Mapa falso com memória: getLayer e getSource respondem pelo que já foi
// adicionado, então os ramos defensivos rodam como rodariam de verdade.
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

const LINHA: LineString = {
  type: 'LineString',
  coordinates: [
    [-43.9, -19.9],
    [-43.89, -19.89],
  ],
};

const props = (over: Partial<MapLineSourceProps> = {}): MapLineSourceProps => ({
  id: 'rota',
  shape: LINHA,
  paint: { color: '#8AD2E2', width: 4 },
  ...over,
});

const render = async (p: MapLineSourceProps, mapa?: MapaFalso) => {
  // A instância é dependência do efeito: se o valor do contexto for recriado a
  // cada render, a camada reanexa sozinha e os testes de reanexo passariam sem
  // provar nada. Aqui ela é estável, como o MapView real a mantém.
  const instancia = { map: mapa, lib: {} } as unknown as MapInstanceContextValue;

  const conteudo = (atual: MapLineSourceProps) =>
    mapa ? (
      <MapInstanceContext.Provider value={instancia}>
        <MapLineSource {...atual} />
      </MapInstanceContext.Provider>
    ) : (
      <MapLineSource {...atual} />
    );

  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(conteudo(p));
  });

  return {
    tree,
    atualizar: async (novos: MapLineSourceProps) => {
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
  layout: Record<string, unknown>;
  paint: Record<string, unknown>;
};

const camadaAdicionada = (mapa: MapaFalso, i = 0) =>
  mapa.addLayer.mock.calls[i][0] as unknown as CamadaAnexada;

const fonteAdicionada = (mapa: MapaFalso) =>
  mapa.addSource.mock.calls[0] as unknown as [string, { type: string; data: unknown }];

describe('MapLineSource no web: o que vai para o mapa', () => {
  // O MapView só provê a instância depois do evento de load; antes disso o
  // componente tem que ficar quieto em vez de estourar.
  it('sem mapa disponível ainda, não tenta anexar nada', async () => {
    const { tree } = await render(props());

    expect(tree.toJSON()).toBeNull();
  });

  it('registra a fonte com o id pedido e a camada derivada dele', async () => {
    const mapa = criarMapa();
    await render(props(), mapa);

    expect(fonteAdicionada(mapa)[0]).toBe('rota');
    expect(camadaAdicionada(mapa)).toMatchObject({
      id: 'rota-layer',
      type: 'line',
      source: 'rota',
    });
  });

  it('traduz o paint unificado para as chaves que o maplibre espera', async () => {
    const mapa = criarMapa();
    await render(props({ paint: { color: '#8AD2E2', width: 4, opacity: 0.5 } }), mapa);

    expect(camadaAdicionada(mapa).paint).toEqual({
      'line-color': '#8AD2E2',
      'line-width': 4,
      'line-opacity': 0.5,
    });
  });

  it('sem opacidade, cap ou join declarados, usa linha opaca de pontas redondas', async () => {
    const mapa = criarMapa();
    await render(props(), mapa);

    expect(camadaAdicionada(mapa).paint['line-opacity']).toBe(1);
    expect(camadaAdicionada(mapa).layout).toEqual({
      'line-cap': 'round',
      'line-join': 'round',
    });
  });

  it('cap e join declarados chegam como pedidos', async () => {
    const mapa = criarMapa();
    await render(props({ paint: { color: '#fff', width: 2, cap: 'square', join: 'miter' } }), mapa);

    expect(camadaAdicionada(mapa).layout).toEqual({
      'line-cap': 'square',
      'line-join': 'miter',
    });
  });

  it('insere a camada abaixo da indicada quando o chamador pede', async () => {
    const mapa = criarMapa();
    await render(props({ beforeId: 'marcadores' }), mapa);

    expect(mapa.addLayer.mock.calls[0][1]).toBe('marcadores');
  });
});

describe('MapLineSource no web: formas aceitas', () => {
  // O maplibre só aceita Feature ou FeatureCollection como dado da fonte;
  // geometria crua precisa ser embrulhada, senão a linha some sem erro.
  it('geometria crua é embrulhada em Feature', async () => {
    const mapa = criarMapa();
    await render(props({ shape: LINHA }), mapa);

    expect(fonteAdicionada(mapa)[1]).toEqual({
      type: 'geojson',
      data: { type: 'Feature', geometry: LINHA, properties: {} },
    });
  });

  it('Feature pronta passa direto, sem reembrulhar', async () => {
    const mapa = criarMapa();
    const feature: Feature<LineString> = {
      type: 'Feature',
      geometry: LINHA,
      properties: { nome: 'rota de fuga' },
    };
    await render(props({ shape: feature }), mapa);

    expect(fonteAdicionada(mapa)[1].data).toBe(feature);
  });

  it('FeatureCollection passa direto', async () => {
    const mapa = criarMapa();
    const colecao: FeatureCollection<LineString> = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: LINHA, properties: {} }],
    };
    await render(props({ shape: colecao }), mapa);

    expect(fonteAdicionada(mapa)[1].data).toBe(colecao);
  });
});

describe('MapLineSource no web: limpeza', () => {
  it('ao sair da tela, tira a camada e a fonte do mapa', async () => {
    const mapa = criarMapa();
    const { desmontar } = await render(props(), mapa);

    await desmontar();

    expect(mapa.removeLayer).toHaveBeenCalledWith('rota-layer');
    expect(mapa.removeSource).toHaveBeenCalledWith('rota');
  });

  // Remontagem (strict mode, navegação de volta) não pode duplicar a camada:
  // o maplibre recusa id repetido e a rota inteira sumiria.
  it('camada e fonte já existentes são derrubadas antes de anexar de novo', async () => {
    const mapa = criarMapa();
    mapa.camadas.add('rota-layer');
    mapa.fontes.add('rota');

    await render(props(), mapa);

    expect(mapa.removeLayer).toHaveBeenCalledWith('rota-layer');
    expect(mapa.removeSource).toHaveBeenCalledWith('rota');
    expect(mapa.addLayer).toHaveBeenCalledTimes(1);
  });

  it('mapa limpo não recebe remoção do que não existe', async () => {
    const mapa = criarMapa();
    await render(props(), mapa);

    expect(mapa.removeLayer).not.toHaveBeenCalled();
    expect(mapa.removeSource).not.toHaveBeenCalled();
  });

  // Contraprova do teste seguinte: só o que está nas dependências do efeito
  // reanexa. Um render com os mesmos valores deixa a linha onde está.
  it('render repetido com os mesmos valores não reanexa a camada', async () => {
    const mapa = criarMapa();
    const { atualizar } = await render(props(), mapa);

    await atualizar(props());

    expect(mapa.addLayer).toHaveBeenCalledTimes(1);
  });

  it('mudar a cor da linha reanexa a camada em vez de deixar a antiga', async () => {
    const mapa = criarMapa();
    const { atualizar } = await render(props(), mapa);

    await atualizar(props({ paint: { color: '#FF0000', width: 4 } }));

    expect(mapa.removeLayer).toHaveBeenCalledWith('rota-layer');
    expect(mapa.addLayer).toHaveBeenCalledTimes(2);
    expect(camadaAdicionada(mapa, 1).paint['line-color']).toBe('#FF0000');
  });
});
