import { act, create } from 'react-test-renderer';
import { MapInstanceContext, type MapInstanceContextValue } from '../../components/MapView.web';
import { MapRasterSource } from '../../components/MapRasterSource.web';
import type { MapRasterSourceProps } from '../../components/MapRasterSource.types';

// Camada de tiles de imagem do mapa no web (radar de chuva). Como as de linha
// e de calor, o componente não desenha: traduz os props para as chamadas
// imperativas do maplibre. O ponto sensível é a troca de observação: os tiles
// de um horário não podem continuar no mapa depois que o horário mudou.

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
    addSource: jest.fn((id: string, _spec: unknown) => {
      fontes.add(id);
    }),
    removeSource: jest.fn((id: string) => fontes.delete(id)),
  };
};

type MapaFalso = ReturnType<typeof criarMapa>;

const TILES = 'https://tiles.exemplo/2026-10-03T11:30:00Z/{z}/{y}/{x}.png';

const props = (over: Partial<MapRasterSourceProps> = {}): MapRasterSourceProps => ({
  id: 'radar',
  tiles: [TILES],
  ...over,
});

const render = async (p: MapRasterSourceProps, mapa?: MapaFalso) => {
  // Instância estável, como o MapView real a mantém: recriada a cada render,
  // a camada reanexaria sozinha e os testes de reanexo não provariam nada.
  const instancia = { map: mapa, lib: {} } as unknown as MapInstanceContextValue;

  const conteudo = (atual: MapRasterSourceProps) =>
    mapa ? (
      <MapInstanceContext.Provider value={instancia}>
        <MapRasterSource {...atual} />
      </MapInstanceContext.Provider>
    ) : (
      <MapRasterSource {...atual} />
    );

  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(conteudo(p));
  });

  return {
    tree,
    atualizar: async (novos: MapRasterSourceProps) => {
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

const fonte = (mapa: MapaFalso, i = 0) =>
  mapa.addSource.mock.calls[i] as unknown as [string, Record<string, unknown>];

const camada = (mapa: MapaFalso, i = 0) =>
  mapa.addLayer.mock.calls[i][0] as unknown as {
    id: string;
    type: string;
    source: string;
    paint: Record<string, unknown>;
  };

describe('MapRasterSource no web: o que vai para o mapa', () => {
  it('sem mapa disponível ainda, não tenta anexar nada', async () => {
    const { tree } = await render(props());

    expect(tree.toJSON()).toBeNull();
  });

  it('registra a fonte de tiles e a camada de imagem derivada do id', async () => {
    const mapa = criarMapa();
    await render(props(), mapa);

    expect(fonte(mapa)[0]).toBe('radar');
    expect(fonte(mapa)[1]).toEqual({ type: 'raster', tiles: [TILES], tileSize: 256 });
    expect(camada(mapa)).toMatchObject({ id: 'radar-layer', type: 'raster', source: 'radar' });
    expect(camada(mapa).paint).toEqual({ 'raster-opacity': 1 });
  });

  it('tamanho do tile, zoom máximo e opacidade declarados chegam como pedidos', async () => {
    const mapa = criarMapa();
    await render(props({ tileSize: 512, maxzoom: 6, opacity: 0.7 }), mapa);

    expect(fonte(mapa)[1]).toEqual({ type: 'raster', tiles: [TILES], tileSize: 512, maxzoom: 6 });
    expect(camada(mapa).paint).toEqual({ 'raster-opacity': 0.7 });
  });

  it('insere a camada abaixo da indicada quando o chamador pede', async () => {
    const mapa = criarMapa();
    await render(props({ beforeId: 'marcadores' }), mapa);

    expect(mapa.addLayer.mock.calls[0][1]).toBe('marcadores');
  });
});

describe('MapRasterSource no web: limpeza e reanexo', () => {
  it('ao sair da tela, tira a camada e a fonte do mapa', async () => {
    const mapa = criarMapa();
    const { desmontar } = await render(props(), mapa);

    await desmontar();

    expect(mapa.removeLayer).toHaveBeenCalledWith('radar-layer');
    expect(mapa.removeSource).toHaveBeenCalledWith('radar');
    expect(mapa.camadas.size).toBe(0);
    expect(mapa.fontes.size).toBe(0);
  });

  it('camada e fonte já existentes são derrubadas antes de anexar de novo', async () => {
    const mapa = criarMapa();
    mapa.camadas.add('radar-layer');
    mapa.fontes.add('radar');

    await render(props(), mapa);

    expect(mapa.removeLayer).toHaveBeenCalledWith('radar-layer');
    expect(mapa.removeSource).toHaveBeenCalledWith('radar');
    expect(mapa.addLayer).toHaveBeenCalledTimes(1);
  });

  it('tiles de outro horário trocam a fonte: sai a antiga, entra a nova', async () => {
    const mapa = criarMapa();
    const { atualizar } = await render(props(), mapa);
    const novos = TILES.replace('11:30', '12:00');

    await atualizar(props({ tiles: [novos] }));

    expect(mapa.removeSource).toHaveBeenCalledWith('radar');
    expect(mapa.addSource).toHaveBeenCalledTimes(2);
    expect(fonte(mapa, 1)[1]).toMatchObject({ tiles: [novos] });
    expect(mapa.fontes.size).toBe(1);
  });

  // Quem chama monta a lista de tiles a cada render. O que identifica a fonte é
  // o conteúdo, e não a identidade da lista.
  it('a mesma lista de tiles recriada entre renders não reanexa a camada', async () => {
    const mapa = criarMapa();
    const { atualizar } = await render(props(), mapa);

    await atualizar(props({ tiles: [TILES] }));

    expect(mapa.addLayer).toHaveBeenCalledTimes(1);
  });
});
