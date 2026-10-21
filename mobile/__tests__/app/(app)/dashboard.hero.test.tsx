import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { gridColumnsToCover, SwiThemeProvider } from '@kavicki/swi-design-system';
import Dashboard from '../../../app/(app)/dashboard';
import { reporting } from '../../../services/telemetry/myTelemetryFixtures';
import type { WatchDiagnosticsState } from '../../../services/telemetry/watchDiagnostics';

// Geometria do hero da home (anel, silhueta, avatar, pino, câmera e pasta).
//
// O hero é desenhado uma única vez em 360 x 431 e escalado de forma uniforme
// pela página: o invólucro recebe largura e altura numéricas, e a tela de
// desenho por dentro recebe um scale igual a largura / 360. Com largura em
// porcentagem e aspectRatio, o Yoga resolvia a altura a partir da largura
// cheia da janela antes de aplicar o maxWidth, e o rodapé (notificações,
// chat e emergência) saía da área útil em todo aparelho. Com largura numérica
// a altura acompanha sempre a largura real do hero.
//
// O Jest não roda o Yoga, então aqui se prova o contrato de estilo que o
// Yoga consome, nas três situações de tela: mais larga que o desenho, mais
// estreita que o desenho e sem altura para o bloco de baixo.

// Mesmos valores de app/(app)/dashboard.tsx.
const HERO_RATIO = 360 / 431;
const HERO_MIN_WIDTH = 220;

// --- Fronteiras dubladas -----------------------------------------------------

const mockSuporte: WatchDiagnosticsState = { support: 'ready' } as WatchDiagnosticsState;
jest.mock('../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: () => mockSuporte,
}));
const mockTelemetria = { telemetry: reporting(), failed: false, loading: false };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => mockTelemetria,
  useRefreshMyTelemetry: () => () => undefined,
}));
// O envio real puxa a tarefa de segundo plano (módulo nativo). Aqui é o
// iPhone, sem Health Connect: a faixa de sincronização não entra.
jest.mock('../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({
    healthConnect: null,
    paired: false,
    syncing: false,
    syncNow: async () => undefined,
  }),
}));
jest.mock('../../../services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: { fullName: 'Trabalhador Teste', avatarUrl: '' } }),
}));
jest.mock('../../../services/notifications/NotificationProvider', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}));
jest.mock('../../../services/reports/ReportsProvider', () => ({
  useReports: () => ({ reports: [], load: jest.fn(async () => {}) }),
}));
jest.mock('../../../services/weather/WeatherProvider', () => ({
  useWeather: () => ({ snapshot: null, activeAlert: null }),
}));
jest.mock('../../../components/NavFABs', () => ({ NavFABs: () => null }));
jest.mock('../../../components/modals/WeatherAlertModal', () => ({
  WeatherAlertModal: () => null,
}));
jest.mock('../../../components/modals/ActiveAlertModal', () => ({
  ActiveAlertModal: () => null,
}));

// --- Helpers -----------------------------------------------------------------

const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

// useWindowDimensions lê Dimensions na montagem; a janela é definida antes.
const janela = (width: number, height: number) => {
  const dims = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: dims, screen: dims });
};

// Cada caso monta uma árvore; o afterEach desmonta dentro de act antes de
// devolver a janela padrão, para a troca de Dimensions não acordar um
// Dashboard ainda montado fora de act.
let montada: ReactTestRenderer | null = null;

const montar = async (width: number, height: number) => {
  janela(width, height);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: INSETS }}>
        <SwiThemeProvider>
          <Dashboard />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  montada = tree;
  return tree;
};

const porTestID = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

const hero = (tree: ReactTestRenderer) => porTestID(tree, 'home-hero').props.style;
const tela = (tree: ReactTestRenderer) => porTestID(tree, 'home-hero-canvas').props.style;

// O bloco de baixo informa a própria altura pelo onLayout; aqui ela é ditada.
const medirBlocoDeBaixo = async (tree: ReactTestRenderer, height: number) => {
  const bloco = tree.root.findAll(
    (n) => typeof n.props?.onLayout === 'function' && n.props?.style?.maxWidth === 360,
  )[0];
  await act(async () => {
    bloco.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height } } });
  });
};

const esperarHero = (tree: ReactTestRenderer, largura: number) => {
  const invólucro = hero(tree);
  expect(invólucro.width).toBeCloseTo(largura, 5);
  expect(invólucro.height).toBeCloseTo(largura / HERO_RATIO, 5);
  expect(invólucro.aspectRatio).toBeUndefined();
  expect(invólucro.maxWidth).toBeUndefined();

  const desenho = tela(tree);
  expect(desenho.width).toBe(360);
  expect(desenho.height).toBe(431);
  expect(desenho.transformOrigin).toBe('top left');
  expect(desenho.transform).toHaveLength(1);
  expect(desenho.transform[0].scale).toBeCloseTo(largura / 360, 5);
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  await act(async () => {
    montada?.unmount();
  });
  montada = null;
  janela(390, 844);
  jest.useRealTimers();
});

// --- Casos -------------------------------------------------------------------

describe('dashboard: geometria do hero', () => {
  it('numa tela mais larga que o desenho, o hero fica em 360 x 431 sem crescer', async () => {
    const tree = await montar(411, 899);

    esperarHero(tree, 360);
    expect(tela(tree).transform[0].scale).toBe(1);
  });

  it('numa tela mais estreita que o desenho, a altura acompanha a largura real', async () => {
    const tree = await montar(320, 760);

    esperarHero(tree, 320);
  });

  it('sem altura para o bloco de baixo, encolhe até o piso pelos dois eixos', async () => {
    const tree = await montar(360, 640);
    await medirBlocoDeBaixo(tree, 370);

    // (640 - 47 - 34 - 370) * HERO_RATIO fica abaixo do piso, então vale o piso.
    esperarHero(tree, HERO_MIN_WIDTH);
  });

  it('a grade de pontos do chart recebe colunas para encostar nas bordas da janela', async () => {
    const tree = await montar(411, 899);

    const grafico = tree.root.findAll((n) => n.props?.accessibilityLabel === 'Status de saúde')[0];
    expect(grafico.props.gridColumns).toBe(gridColumnsToCover(411, 1));
    expect(grafico.props.gridColumns).toBeGreaterThan(27);
  });

  it('com altura de sobra, o bloco de baixo medido não mexe no hero', async () => {
    const tree = await montar(411, 899);
    await medirBlocoDeBaixo(tree, 370);

    esperarHero(tree, 360);
  });
});
