import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Dashboard from '../../../app/(app)/dashboard';
import { reporting } from '../../../services/telemetry/myTelemetryFixtures';
import type { WatchDiagnosticsState } from '../../../services/telemetry/watchDiagnostics';

const mockLeitura = reporting();

// O botão "Ajuda urgente" pede ajuda de verdade: o toque vai ao provider do
// pedido (que manda a posição e o pedido ao servidor), com ou sem alerta de
// clima vigente, e as janelas do procedimento continuam abrindo como antes.
// O envio em si tem suíte própria (HelpRequestProvider.test.tsx).

const mockRequestHelp = jest.fn();
jest.mock('../../../services/help/HelpRequestProvider', () => ({
  useHelpRequest: () => ({
    helpRequest: null,
    sending: false,
    failed: false,
    rescuerEtaMin: null,
    requestHelp: mockRequestHelp,
  }),
}));

jest.mock('../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: () => ({ support: 'ready' }) as WatchDiagnosticsState,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => ({ telemetry: mockLeitura, failed: false, loading: false }),
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
const ALERTA = { id: 'wx-1', event: 'Tempestade', severity: 'PERIGO', description: 'Procure abrigo.' };
let mockAlertaVigente: typeof ALERTA | null = ALERTA;
jest.mock('../../../services/weather/WeatherProvider', () => ({
  useWeather: () => ({ snapshot: null, activeAlert: mockAlertaVigente }),
}));
jest.mock('../../../components/NavFABs', () => ({ NavFABs: () => null }));
jest.mock('../../../components/telemetry/ReadinessList', () => ({
  DashboardReadiness: ({ children }: { children: unknown }) => children,
}));
jest.mock('../../../components/modals/WeatherAlertModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WeatherAlertModal: () => React.createElement(View, { testID: 'modal-clima' }) };
});
jest.mock('../../../components/modals/ActiveAlertModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ActiveAlertModal: (p: { visible: boolean }) =>
      React.createElement(View, { testID: 'modal-alerta-ativo', visible: p.visible }),
  };
});

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

const tocarAjuda = async (tree: ReactTestRenderer) => {
  const botao = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === 'Ajuda urgente' && typeof n.props?.onPress === 'function',
  )[0];
  await act(async () => {
    botao.props.onPress();
  });
};

const porTestID = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockAlertaVigente = ALERTA;
});

describe('dashboard: o botão de ajuda urgente pede ajuda', () => {
  it('montar a tela não pede nada', async () => {
    await montar();

    expect(mockRequestHelp).not.toHaveBeenCalled();
  });

  it('com alerta de clima: pede ajuda e abre a janela do clima', async () => {
    const tree = await montar();

    await tocarAjuda(tree);

    expect(mockRequestHelp).toHaveBeenCalledTimes(1);
    expect(porTestID(tree, 'modal-clima')).toBeDefined();
  });

  it('sem alerta de clima: pede ajuda e abre direto o procedimento', async () => {
    mockAlertaVigente = null;
    const tree = await montar();

    await tocarAjuda(tree);

    expect(mockRequestHelp).toHaveBeenCalledTimes(1);
    expect(porTestID(tree, 'modal-alerta-ativo').props.visible).toBe(true);
  });
});
