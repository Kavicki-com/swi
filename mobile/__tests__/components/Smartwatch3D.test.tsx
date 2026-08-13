import type { ReactNode } from 'react';
import { act, create } from 'react-test-renderer';
import { PanResponder } from 'react-native';
import type { Smartwatch3DProps } from '../../components/Smartwatch3D.types';

// Visualizador 3D do smartband (native). É a tela de onboarding do aparelho: o
// que a pessoa vê enquanto o modelo de ~4MB não chega é o indicador de carga, e
// o que ela NÃO pode ver é um app travado por download que falhou.
//
// O componente carrega o .glb por fora do GLTFLoader.load (fetch quebrado no
// RN/Hermes): asset, download, bytes, parse. Cada etapa dessa fila tem um jeito
// de falhar, e é isso que estes testes cercam, junto do laço de rotação e da
// cache de módulo.
//
// ORDEM IMPORTA: `cachedScene` vive no MÓDULO. Uma vez preenchida, nenhuma
// montagem seguinte baixa nada. Por isso os caminhos de falha e o de chamadas
// concorrentes vêm ANTES do caminho feliz, e a cache é verificada no fim.

jest.mock('../../assets/smartwatch.glb', () => 'smartwatch.glb', { virtual: true });

const mockDownloadAsync = jest.fn(() => Promise.resolve());
const mockAsset = {
  uri: 'https://cdn/smartwatch.glb',
  localUri: 'file:///cache/smartwatch.glb',
  downloaded: false,
  downloadAsync: () => mockDownloadAsync(),
};
jest.mock('expo-asset', () => ({ Asset: { fromModule: () => mockAsset } }));

const mockArrayBuffer = jest.fn(() => Promise.resolve(new ArrayBuffer(8)));
let mockArquivoAberto: string | null = null;
jest.mock('expo-file-system', () => ({
  File: class {
    constructor(uri: string) {
      mockArquivoAberto = uri;
    }
    arrayBuffer() {
      return mockArrayBuffer();
    }
  },
}));

// A cena é quase opaca para o componente: ele só a repassa para o `primitive`.
// O `children` existe porque o log de diagnóstico lê `scene.children.length`, e
// o argumento é avaliado mesmo com o log desligado. Uma cena sem `children` faz
// a carga inteira falhar sem nenhum aviso.
const CENA = { nome: 'cena-do-relogio', children: [] };

type Parse = (
  buffer: unknown,
  path: string,
  onLoad: (gltf: { scene: unknown }) => void,
  onError: (err: unknown) => void,
) => void;
const parseQueDaCerto: Parse = (_b, _p, onLoad) => onLoad({ scene: CENA });
let mockParse: Parse = parseQueDaCerto;
jest.mock('three-stdlib', () => ({
  GLTFLoader: class {
    parse(...args: Parameters<Parse>) {
      return mockParse(...args);
    }
  },
}));

// O Canvas real abre um contexto GL do expo-gl. Aqui vira um host component
// que renderiza os filhos, guarda os próprios props e avisa o onCreated como o
// original faria quando o contexto sobe.
const mockQuadros: ((state: unknown, delta: number) => void)[] = [];
jest.mock('@react-three/fiber/native', () => ({
  Canvas: ({ children, ...props }: { children?: ReactNode; onCreated?: (s: unknown) => void }) => {
    props.onCreated?.({ gl: {}, scene: {}, camera: {} });
    return require('react').createElement('canvas-3d', props, children);
  },
  useFrame: (cb: (state: unknown, delta: number) => void) => {
    mockQuadros.push(cb);
  },
}));

const { Smartwatch3D } =
  require('../../components/Smartwatch3D.native') as typeof import('../../components/Smartwatch3D.native');

// O `primitive` é host component: no test renderer a ref só existe via
// createNodeMock. Este objeto é onde o laço de rotação escreve.
const no = { rotation: { x: 0, y: 0 } };

const montadas: ReturnType<typeof create>[] = [];

const render = async (props: Partial<Smartwatch3DProps> = {}) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<Smartwatch3D width={320} height={320} testID="sw3d" {...props} />, {
      createNodeMock: () => no,
    });
  });
  // A fila de carga encadeia vários await; um único ciclo do act não a esgota.
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  montadas.push(tree);
  return tree;
};

// `canvas-3d` é o host component do dublê do Canvas; o TS não conhece esse
// nome, daí a comparação por string solta.
const canvas = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => String(n.type) === 'canvas-3d')[0];

const indicador = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.props?.size === 'large')[0];

const modelo = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.type === 'primitive')[0];

// O componente entrega a configuração do gesto para o PanResponder; é ali que
// os testes de arraste pegam os callbacks, sem precisar de evento sintético.
const configDoGesto = async (props: Partial<Smartwatch3DProps> = {}) => {
  const criar = jest.spyOn(PanResponder, 'create');
  await render(props);
  const config = criar.mock.calls[0][0];
  criar.mockRestore();
  return config;
};

// O preset reseta as implementações entre testes, então os dublês da fila de
// carga são reafirmados aqui para TODOS os blocos, não só o primeiro.
beforeEach(() => {
  jest.clearAllMocks();
  mockDownloadAsync.mockResolvedValue(undefined);
  mockArrayBuffer.mockResolvedValue(new ArrayBuffer(8));
  mockAsset.localUri = 'file:///cache/smartwatch.glb';
  mockAsset.uri = 'https://cdn/smartwatch.glb';
  mockParse = parseQueDaCerto;
});

afterEach(async () => {
  await act(async () => {
    montadas.splice(0).forEach((t) => t.unmount());
  });
  mockQuadros.length = 0;
  no.rotation.x = 0;
  no.rotation.y = 0;
});

describe('Smartwatch3D: o que falha antes da cena existir', () => {
  it('download que não passa deixa o indicador de carga no lugar, sem derrubar a tela', async () => {
    mockDownloadAsync.mockImplementationOnce(() => Promise.reject(new Error('sem rede')));
    const tree = await render();

    expect(canvas(tree)).toBeUndefined();
    expect(indicador(tree)).toBeDefined();
  });

  // Sem localUri nem uri não há arquivo para abrir: a falha tem que sair antes
  // do File, não virar caminho 'undefined'.
  it('asset sem caminho local não chega a abrir arquivo nenhum', async () => {
    mockAsset.localUri = '';
    mockAsset.uri = '';
    mockArquivoAberto = null;

    const tree = await render();

    expect(mockArquivoAberto).toBeNull();
    expect(canvas(tree)).toBeUndefined();
  });

  it('arquivo de zero byte não vai para o parser', async () => {
    mockArrayBuffer.mockResolvedValueOnce(new ArrayBuffer(0));
    const tree = await render();

    expect(canvas(tree)).toBeUndefined();
  });

  it('parse recusado mantém o indicador em vez de cena pela metade', async () => {
    mockParse = (_b, _p, _onLoad, onError) => onError('glb corrompido');
    const tree = await render();

    expect(canvas(tree)).toBeUndefined();
    expect(indicador(tree)).toBeDefined();
  });

  // Navegação rápida entre as duas telas de onboarding monta o componente duas
  // vezes; sem o dedupe seriam dois downloads de ~4MB em paralelo. A carga
  // compartilhada termina em falha de propósito: um sucesso aqui encheria a
  // cache de módulo e os testes seguintes nunca mais exercitariam a fila.
  it('a segunda montagem entra na carga em voo em vez de baixar de novo', async () => {
    let derrubar!: (e: Error) => void;
    mockDownloadAsync.mockImplementationOnce(
      () =>
        new Promise<void>((_res, rej) => {
          derrubar = rej;
        }),
    );

    const primeira = await render();
    const segunda = await render();

    expect(mockDownloadAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      derrubar(new Error('sem rede'));
    });

    expect(canvas(primeira)).toBeUndefined();
    expect(canvas(segunda)).toBeUndefined();
  });
});

describe('Smartwatch3D: com a cena carregada', () => {
  // O uri local é o que o componente manda para o File; vindo do `localUri`, é
  // esse que tem que ser aberto, não a URL remota. Esta é a primeira carga que
  // chega ao fim: daqui em diante a cena vive na cache do módulo.
  it('abre o arquivo baixado, não a URL remota', async () => {
    mockArquivoAberto = null;
    await render();

    expect(mockArquivoAberto).toBe('file:///cache/smartwatch.glb');
  });

  it('mostra o canvas com o modelo na escala pedida', async () => {
    const tree = await render({ scale: 1.5 });

    expect(canvas(tree)).toBeDefined();
    expect(modelo(tree).props.object).toBe(CENA);
    expect(modelo(tree).props.scale).toBe(1.5);
  });

  it('respeita a moldura pedida pela tela', async () => {
    const tree = await render({ width: 240, height: 180 });

    const moldura = tree.root.findAll((n) => n.props?.testID === 'sw3d' && n.props?.style)[0];
    expect(moldura.props.style).toMatchObject({ width: 240, height: 180 });
  });

  // A cena já está na cache de módulo desde os testes acima: montar de novo
  // não pode disparar download nenhum.
  it('a segunda tela pega o modelo da cache, sem baixar de novo', async () => {
    const tree = await render();

    expect(mockDownloadAsync).not.toHaveBeenCalled();
    expect(canvas(tree)).toBeDefined();
  });
});

describe('Smartwatch3D: laço de rotação', () => {
  const quadro = (delta: number) => mockQuadros.forEach((cb) => cb({}, delta));

  // O ângulo de partida é falseado para um valor que o componente nunca
  // escreveria: se o laço rodar sem motivo, ele sobrescreve com o ref (zero) e
  // o teste vê. Sem isso, "não escreveu" e "escreveu zero" ficariam iguais.
  it('parado e sem auto-rotação, o laço não escreve nada', async () => {
    await render({ autoRotate: false });
    no.rotation.y = 42;
    no.rotation.x = 42;

    quadro(0.5);

    expect(no.rotation.y).toBe(42);
    expect(no.rotation.x).toBe(42);
  });

  it('com auto-rotação, gira em torno do eixo Y proporcional ao tempo do quadro', async () => {
    await render({ autoRotate: true });

    quadro(0.5);

    expect(no.rotation.y).toBeCloseTo(0.2);
    expect(no.rotation.x).toBe(0);
  });

  it('o arraste gira o modelo e a auto-rotação para de somar enquanto o dedo está na tela', async () => {
    const config = await configDoGesto({ autoRotate: true });

    config.onPanResponderGrant?.({} as never, {} as never);
    config.onPanResponderMove?.({} as never, { dx: 100, dy: -50 } as never);
    quadro(0.5);

    // dx/200 * PI para Y, dy/200 * PI para X. Nada somado pela auto-rotação.
    expect(no.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(no.rotation.x).toBeCloseTo(-Math.PI / 4);
  });

  it('soltando o dedo, a auto-rotação volta a somar de onde o arraste parou', async () => {
    const config = await configDoGesto({ autoRotate: true });

    config.onPanResponderGrant?.({} as never, {} as never);
    config.onPanResponderMove?.({} as never, { dx: 200, dy: 0 } as never);
    config.onPanResponderRelease?.({} as never, {} as never);
    quadro(0.5);

    expect(no.rotation.y).toBeCloseTo(Math.PI + 0.2);
  });

  // Gesto interrompido pelo sistema (uma chamada entrando, por exemplo) tem que
  // devolver o controle para a auto-rotação, senão o modelo congela.
  it('gesto cancelado pelo sistema não deixa o modelo travado em arraste', async () => {
    const config = await configDoGesto({ autoRotate: true });

    config.onPanResponderGrant?.({} as never, {} as never);
    config.onPanResponderTerminate?.({} as never, {} as never);
    quadro(0.5);

    expect(no.rotation.y).toBeCloseTo(0.2);
  });

  it('sem interatividade, o componente não assume o gesto', async () => {
    const config = await configDoGesto({ interactive: false });

    expect(config.onStartShouldSetPanResponder?.({} as never, {} as never)).toBe(false);
    expect(config.onMoveShouldSetPanResponder?.({} as never, {} as never)).toBe(false);
  });

  it('interativo, o componente assume o gesto', async () => {
    const config = await configDoGesto({ interactive: true });

    expect(config.onStartShouldSetPanResponder?.({} as never, {} as never)).toBe(true);
    expect(config.onMoveShouldSetPanResponder?.({} as never, {} as never)).toBe(true);
  });
});
