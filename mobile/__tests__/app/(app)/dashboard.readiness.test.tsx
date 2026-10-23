import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, SwiThemeProvider } from '@kavicki/swi-design-system';
import Dashboard from '../../../app/(app)/dashboard';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import type { HealthConnectState } from '../../../services/telemetry/healthConnect/healthConnectReader';
import type { BandChoice } from '../../../services/telemetry/bluetooth/bluetoothBandChoice';
import type { Profile } from '../../../services/profile/types';
import type { MyTelemetryState } from '../../../services/vitals/MyTelemetryProvider';

// O dashboard do Android não carrega a lista de prontidão: ela mora em
// Configurações, Monitoramento, e no dashboard empurrava o rodapé para fora da
// tela. Mesmo com todos os passos faltando, ali fica só a linha de estado. A
// faixa de sincronização, que também saiu, está em dashboard.integration.

// --- Fronteiras dubladas -----------------------------------------------------

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: () => ({ support: 'unsupported' }),
}));

const mockSemLeitura: MyTelemetryState = { telemetry: null, failed: false, loading: false };
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => mockSemLeitura,
  useRefreshMyTelemetry: () => () => undefined,
}));

// Tudo faltando: pareamento, leitura, segundo plano, app do fabricante,
// pulseira e data de nascimento.
const mockHcFaltando: HealthConnectState = {
  availability: 'available',
  permission: 'denied',
  backgroundPermission: 'denied',
  bandPackage: null,
  bandLabel: null,
  noBand: false,
  lastSyncAt: null,
};
const mockConferir = jest.fn(async () => 'available' as const);
jest.mock('../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({
    paired: false,
    healthConnect: mockHcFaltando,
    syncing: false,
    syncNow: async () => undefined,
    checkHealthConnect: mockConferir,
    requestHealthConnectPermission: jest.fn(),
    openHealthConnectSettings: jest.fn(),
  }),
}));

const mockSemPulseira: BandChoice | null = null;
jest.mock('../../../services/telemetry/bluetooth/bluetoothBandChoice', () => ({
  sharedBandChoiceStore: () => ({}),
  useBandChoice: () => mockSemPulseira,
}));

const mockSemNascimento: Profile = { fullName: 'Trabalhador Teste' };
jest.mock('../../../services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: mockSemNascimento }),
}));

jest.mock('../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'func-1' } }),
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
jest.mock('../../../services/live/useLiveBroadcast', () => ({
  useLiveBroadcast: () => ({ live: false, notice: null, toggle: jest.fn(), dismissNotice: jest.fn() }),
}));

jest.mock('../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));
const mockGate = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

// --- Helpers -----------------------------------------------------------------

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let tree: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => {
    tree?.unmount();
    tree = null;
  });
});

const montar = async () => {
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <Dashboard />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree!;
};

const textos = (t: ReactTestRenderer) =>
  t.root
    .findAll((n) => typeof n.props.children === 'string' && typeof n.type !== 'string')
    .map((n) => n.props.children as string);

const rotulosDeBotao = (t: ReactTestRenderer) =>
  t.root
    .findAllByType(Button as React.ComponentType<{ label: string }>)
    .map((b) => b.props.label);

// --- Casos -------------------------------------------------------------------

beforeEach(() => {
  naPlataforma('android');
  mockGate.mockImplementation((gate) => gate === 'healthConnect' || gate === 'bluetoothHeartRate');
  jest.clearAllMocks();
});

afterAll(() => {
  naPlataforma(originalOS);
});

describe('dashboard no Android: a prontidão fica no Monitoramento', () => {
  it('não mostra a lista de prontidão, mesmo com todos os passos faltando', async () => {
    const t = await montar();
    expect(t.root.findAll((n) => n.props.testID === 'readiness-list')).toHaveLength(0);
    expect(textos(t)).not.toContain('Para o monitoramento funcionar');
    for (const rotulo of ['Parear aparelho', 'Escolher a pulseira', 'Entendi']) {
      expect(rotulosDeBotao(t)).not.toContain(rotulo);
    }
  });

  it('a linha de estado fica no lugar', async () => {
    const t = await montar();
    expect(textos(t)).toContain('Sem leitura do aparelho');
  });
});
