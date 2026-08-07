import type { ReactNode } from 'react';
import { act, create } from 'react-test-renderer';

// Raiz do app (`app/_layout.tsx`). É a única tela cuja falha aparece como
// "app pendurado no splash": ela segura o render inteiro até as fontes
// chegarem, e o que estes testes cercam é justamente o desbloqueio, por
// sucesso, por erro de fonte, ou pelo prazo de 2s. Junto vão as duas raízes
// null-render (telemetria e heartbeat de posição), que decidem o que sai do
// aparelho, e a configuração do Stack.
//
// Plataforma: este arquivo cobre o caminho NATIVE. `IS_WEB` é calculado no
// módulo, durante o import, então o caminho web (FontFace API) mora em
// arquivo separado, com o Platform dublado antes do import.

// O SafeAreaProvider real só renderiza os filhos DEPOIS que o módulo nativo
// mede as insets, e no test renderer isso nunca acontece: a árvore ficaria
// vazia. O dublê é o que o próprio pacote publica (como export default).
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

// O GestureHandlerRootView real instala o módulo nativo no primeiro render e
// morre fora de um app compilado. Vira uma View: o que este arquivo mede está
// abaixo dele na árvore.
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: require('react-native').View,
}));

let mockFontsLoaded = true;
let mockFontError: Error | null = null;
const mockUseFonts = jest.fn((_map: unknown) => [mockFontsLoaded, mockFontError]);
jest.mock('expo-font', () => ({ useFonts: (m: unknown) => mockUseFonts(m) }));

const mockPreventAutoHide = jest.fn();
const mockHideAsync = jest.fn();
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: () => mockPreventAutoHide(),
  hideAsync: () => mockHideAsync(),
}));

// O transformador de assets do jest-expo não conhece `.glb`, então o require
// do modelo do smartband entra no runtime como binário e quebra o parser.
jest.mock('../../assets/smartwatch.glb', () => 'smartwatch.glb', { virtual: true });

const mockLoadAsync = jest.fn((_assets: unknown) => Promise.resolve([]));
jest.mock('expo-asset', () => ({ Asset: { loadAsync: (a: unknown) => mockLoadAsync(a) } }));

// O Stack real precisa do contexto de navegação do expo-router. Aqui ele vira
// um dublê que guarda os próprios props e renderiza os filhos, para o teste
// inspecionar as opções de tela sem montar o navegador inteiro.
const mockStack = Object.assign(
  ({ children }: { children?: ReactNode; screenOptions?: unknown }) => <>{children}</>,
  { Screen: (_props: { name: string; options?: unknown }) => null },
);
jest.mock('expo-router', () => ({ Stack: mockStack }));

let mockAuth: { user: unknown } = { user: { id: 'u-1' } };
let mockVitals: unknown = { heartRate: 72 };
let mockLocation: { coords: [number, number] | null; source: string } = {
  coords: [-46.6, -23.5],
  source: 'gps',
};

jest.mock('../../services/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => mockAuth,
}));
jest.mock('../../services/profile/ProfileProvider', () => ({
  ProfileProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../../services/reports/ReportsProvider', () => ({
  ReportsProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../../services/vitals/VitalsProvider', () => ({
  VitalsProvider: ({ children }: { children: ReactNode }) => children,
  useVitals: () => ({ vitals: mockVitals }),
}));
jest.mock('../../services/location/LocationProvider', () => ({
  LocationProvider: ({ children }: { children: ReactNode }) => children,
  useLocation: () => mockLocation,
}));
jest.mock('../../services/weather/WeatherProvider', () => ({
  WeatherProvider: ({ children }: { children: ReactNode }) => children,
}));

const mockSampler = jest.fn();
jest.mock('../../services/telemetry/useTelemetrySampler', () => ({
  useTelemetrySampler: (v: unknown, c: unknown) => mockSampler(v, c),
}));
const mockHeartbeat = jest.fn();
jest.mock('../../services/positions/usePositionHeartbeat', () => ({
  usePositionHeartbeat: (g: unknown) => mockHeartbeat(g),
}));

// `import` é içado para ANTES destes dublês, e o módulo da raiz chama
// `SplashScreen.preventAutoHideAsync()` já na carga: com import estático o
// dublê ainda não existe e a suíte morre em "is not a function". Por isso o
// require fica aqui embaixo, depois de tudo declarado.
const RootLayout = require('../../app/_layout').default as () => ReactNode;

// Toda árvore montada entra aqui: o timeout de fonte é um setTimeout de 2s que
// sobrevive ao teste e dispara setState fora do act na suíte seguinte.
const montadas: ReturnType<typeof create>[] = [];

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<RootLayout />);
  });
  montadas.push(tree);
  return tree;
};

const desmontarTudo = async () => {
  await act(async () => {
    montadas.splice(0).forEach((t) => t.unmount());
  });
};

const stackProps = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.type === mockStack)[0]?.props as
    | { screenOptions: Record<string, unknown> }
    | undefined;

const screens = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => n.type === mockStack.Screen)
    .map((n) => n.props as { name: string; options?: { presentation?: string } });

beforeEach(() => {
  jest.clearAllMocks();
  mockFontsLoaded = true;
  mockFontError = null;
  mockAuth = { user: { id: 'u-1' } };
  mockVitals = { heartRate: 72 };
  mockLocation = { coords: [-46.6, -23.5], source: 'gps' };
});

afterEach(desmontarTudo);

describe('RootLayout: o que destrava o render', () => {
  it('com as fontes carregadas, monta a árvore de navegação', async () => {
    const tree = await render();
    expect(stackProps(tree)).toBeDefined();
  });

  it('enquanto as fontes não chegam, não renderiza nada e mantém o splash', async () => {
    mockFontsLoaded = false;
    const tree = await render();

    expect(tree.toJSON()).toBeNull();
    expect(mockHideAsync).not.toHaveBeenCalled();
  });

  // Fonte que não baixa não pode virar app pendurado: o RN cai para a fonte do
  // sistema e a pessoa continua usando o app, com tipo degradado.
  it('erro ao carregar fonte libera o render mesmo assim', async () => {
    mockFontsLoaded = false;
    mockFontError = new Error('CDN fora do ar');
    const tree = await render();

    expect(stackProps(tree)).toBeDefined();
  });

  it('sem fonte e sem erro, o prazo de 2s destrava o render sozinho', async () => {
    jest.useFakeTimers();
    mockFontsLoaded = false;
    const tree = await render();
    expect(tree.toJSON()).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(stackProps(tree)).toBeDefined();

    // Desmonta com os timers ainda falsos: voltar para os reais com a árvore de
    // pé deixa o setTimeout pendente disparando setState na suíte seguinte.
    await desmontarTudo();
    jest.useRealTimers();
  });

  it('esconde o splash assim que o render é liberado', async () => {
    await render();
    expect(mockHideAsync).toHaveBeenCalledTimes(1);
  });
});

describe('RootLayout: fontes em native', () => {
  it('mapeia os seis pesos que o design system pede pelo nome', async () => {
    await render();

    const mapa = mockUseFonts.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(mapa).sort()).toEqual([
      'Inter',
      'Inter-Bold',
      'Inter-Medium',
      'Montserrat',
      'Montserrat-Medium',
      'Montserrat-Regular',
    ]);
  });
});

describe('RootLayout: pré-carga de assets', () => {
  it('aquece o cache com o fundo do login e o modelo do smartband', async () => {
    await render();

    expect(mockLoadAsync).toHaveBeenCalledTimes(1);
    expect(mockLoadAsync.mock.calls[0][0] as unknown[]).toHaveLength(2);
  });

  // Best-effort: o require em tempo de uso ainda resolve, então a falha do
  // preload não pode derrubar a raiz do app.
  it('falha na pré-carga não derruba a árvore', async () => {
    // A promessa recusada precisa nascer DENTRO da chamada: criada antes do
    // render ela fica um tick sem handler e o node derruba o processo.
    mockLoadAsync.mockImplementationOnce(() => Promise.reject(new Error('sem rede')) as never);
    const tree = await render();

    expect(stackProps(tree)).toBeDefined();
  });
});

describe('RootLayout: telemetria e heartbeat de posição', () => {
  it('entrega getters vivos de vitais e coordenadas ao amostrador', async () => {
    await render();

    const [getVitals, getCoords] = mockSampler.mock.calls[0] as [() => unknown, () => unknown];
    expect(getVitals()).toEqual({ heartRate: 72 });
    expect(getCoords()).toEqual([-46.6, -23.5]);
  });

  it('logado e com GPS real, o heartbeat recebe a coordenada', async () => {
    await render();

    const getter = mockHeartbeat.mock.calls[0][0] as () => unknown;
    expect(getter()).toEqual([-46.6, -23.5]);
  });

  // Sem login o POST só viraria 401 a cada batida.
  it('deslogado, o heartbeat não recebe posição', async () => {
    mockAuth = { user: null };
    await render();

    const getter = mockHeartbeat.mock.calls[0][0] as () => unknown;
    expect(getter()).toBeNull();
  });

  // A posição simulada do provider não pode virar "última posição" do
  // trabalhador no mapa do admin.
  it('com posição simulada (source diferente de gps), o heartbeat não recebe posição', async () => {
    mockLocation = { coords: [-46.6, -23.5], source: 'mock' };
    await render();

    const getter = mockHeartbeat.mock.calls[0][0] as () => unknown;
    expect(getter()).toBeNull();
  });
});

describe('RootLayout: configuração do Stack', () => {
  it('esconde o header nativo e congela telas fora de foco', async () => {
    const tree = await render();

    expect(stackProps(tree)!.screenOptions).toMatchObject({
      headerShown: false,
      freezeOnBlur: true,
      animation: 'slide_from_right',
      animationDuration: 250,
    });
  });

  it('declara os três grupos de rota e os três modais', async () => {
    const tree = await render();

    expect(screens(tree).map((s) => s.name)).toEqual([
      '(auth)',
      '(onboarding)',
      '(app)',
      'modals/support-form',
      'modals/privacy-policy',
      'modals/weather-alert',
    ]);
  });

  it('os três modais são apresentados por cima da tela, sem cobri-la', async () => {
    const tree = await render();
    const modais = screens(tree).filter((s) => s.name.startsWith('modals/'));

    expect(modais).toHaveLength(3);
    modais.forEach((m) => expect(m.options?.presentation).toBe('transparentModal'));
  });
});
