import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Dashboard from '../../../app/(app)/dashboard';
import type { ActiveCondition, WorkerTelemetry } from '../../../services/telemetry/myTelemetry';
import { condition, expired, metric, reporting } from '../../../services/telemetry/myTelemetryFixtures';
import type { MyTelemetryState } from '../../../services/vitals/MyTelemetryProvider';
import type { WatchDiagnosticsState } from '../../../services/telemetry/watchDiagnostics';

// O avatar da home pela tabela do estado do funcionário: sem batimento válido
// fica neutro, mesmo com condição aberta, e com ele a condição pinta enquanto
// o dado que a sustenta vale. A condição não some da leitura; só a cor deixa
// de afirmar o agora com dado velho.

const OBSERVED_AT = reporting().observedAt;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const before = (ms: number) => new Date(Date.parse(OBSERVED_AT) - ms).toISOString();

/** Condição de pressão medida no instante dado. */
const pressaoAlta = (measuredAt: string): ActiveCondition => ({
  ...condition('URGENT', 'BLOOD_PRESSURE_HIGH'),
  measuredAt,
});

// --- Fronteiras dubladas -----------------------------------------------------

let mockTelemetria: MyTelemetryState = { telemetry: reporting(), failed: false, loading: false };
const lendo = (telemetry: WorkerTelemetry) => {
  mockTelemetria = { telemetry, failed: false, loading: false };
};

jest.mock('../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: (): WatchDiagnosticsState => ({ support: 'ready' }) as WatchDiagnosticsState,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => mockTelemetria,
  useRefreshMyTelemetry: () => () => undefined,
}));
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

// --- Helpers -----------------------------------------------------------------

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const montar = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <Dashboard />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const corDoAvatar = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.accessibilityLabel === 'Status de saúde')[0].props.condition;

/** O selo do peito; o tamanho que o Figma cravou é único na tela. */
const selosDeCoracao = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.size === 26.093);

function textoDa(tree: ReactTestRenderer): string {
  const pedacos: string[] = [];
  tree.root.findAll(() => true).forEach((n) => {
    const c = n.props?.children;
    if (typeof c === 'string' || typeof c === 'number') pedacos.push(String(c));
    else if (Array.isArray(c) && c.every((p) => typeof p === 'string' || typeof p === 'number'))
      pedacos.push(c.join(''));
  });
  return pedacos.join('\n');
}

// --- Casos -------------------------------------------------------------------

describe('dashboard: avatar pela tabela do estado do funcionário', () => {
  it('condição urgente aberta com a leitura velha deixa o avatar neutro, sem selo', async () => {
    lendo({
      ...reporting({ heartRate: expired(148, before(6 * HOUR)) }),
      conditions: [condition('URGENT')],
    });
    const tree = await montar();

    expect(corDoAvatar(tree)).toBe('neutral');
    expect(selosDeCoracao(tree)).toHaveLength(0);
  });

  it('a mesma condição com batimento válido pinta o avatar de urgente', async () => {
    lendo({ ...reporting(), conditions: [condition('URGENT')] });
    const tree = await montar();

    expect(corDoAvatar(tree)).toBe('low');
    expect(selosDeCoracao(tree).length).toBeGreaterThan(0);
  });

  it('batimento do Health Connect de 30 min é válido: o avatar sai do neutro', async () => {
    lendo({
      ...reporting({
        heartRate: metric(84, { quality: 'UNAVAILABLE', measuredAt: before(30 * MINUTE), source: 'HEALTH_CONNECT' }),
      }),
      conditions: [condition('HEALTH')],
    });

    expect(corDoAvatar(await montar())).toBe('alert');
  });

  it('pressão medida há 7 h não pinta mais, e a medição segue na tela', async () => {
    lendo({
      ...reporting({ bloodPressure: metric({ systolic: 165, diastolic: 100 }, { measuredAt: before(7 * HOUR) }) }),
      conditions: [pressaoAlta(before(7 * HOUR))],
    });
    const tree = await montar();

    expect(corDoAvatar(tree)).toBe('good');
    expect(textoDa(tree)).toContain('165/100');
  });

  it('pressão medida há 5 h ainda pinta', async () => {
    lendo({
      ...reporting({ bloodPressure: metric({ systolic: 165, diastolic: 100 }, { measuredAt: before(5 * HOUR) }) }),
      conditions: [pressaoAlta(before(5 * HOUR))],
    });

    expect(corDoAvatar(await montar())).toBe('low');
  });
});
