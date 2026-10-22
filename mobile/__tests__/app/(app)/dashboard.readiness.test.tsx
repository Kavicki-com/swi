import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, StatusTag, SwiThemeProvider } from '@kavicki/swi-design-system';
import * as SecureStore from 'expo-secure-store';
import Dashboard from '../../../app/(app)/dashboard';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import type { HealthConnectState } from '../../../services/telemetry/healthConnect/healthConnectReader';
import { openHealthConnectInPlayStore } from '../../../services/telemetry/healthConnect/playStore';
import type { BandChoice } from '../../../services/telemetry/bluetooth/bluetoothBandChoice';
import type { Profile } from '../../../services/profile/types';
import type { MyTelemetryState } from '../../../services/vitals/MyTelemetryProvider';

// A lista de prontidão no dashboard do Android: no lugar da linha de estado,
// os passos abertos na ordem, cada um com a ação a um toque; "Entendi" só
// esconde quando faltam apenas opcionais, e a lista volta quando um passo
// obrigatório volta a faltar. Afirma o que a pessoa lê e para onde cada toque
// vai, com o envio, o perfil, o login, a pulseira escolhida e o SecureStore
// dublados.

// --- Fronteiras dubladas -----------------------------------------------------

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: () => ({ support: 'unsupported' }),
}));

const SEM_LEITURA: MyTelemetryState = { telemetry: null, failed: false, loading: false };
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => SEM_LEITURA,
  useRefreshMyTelemetry: () => () => undefined,
}));

const HC_PRONTO: HealthConnectState = {
  availability: 'available',
  permission: 'granted',
  backgroundPermission: 'granted',
  bandPackage: 'com.xiaomi.wearable',
  bandLabel: 'Mi Fitness',
  noBand: false,
  lastSyncAt: null,
};
let mockPaired = true;
let mockHealthConnect: HealthConnectState | null = HC_PRONTO;
const mockPedirPermissao = jest.fn(async () => 'granted' as const);
const mockAbrirAjustes = jest.fn();
const mockConferir = jest.fn(async () => 'available' as const);
jest.mock('../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({
    paired: mockPaired,
    healthConnect: mockHealthConnect,
    syncing: false,
    syncNow: async () => undefined,
    checkHealthConnect: mockConferir,
    requestHealthConnectPermission: mockPedirPermissao,
    openHealthConnectSettings: mockAbrirAjustes,
  }),
}));

jest.mock('../../../services/telemetry/healthConnect/playStore', () => ({
  openHealthConnectInPlayStore: jest.fn(async () => undefined),
}));

let mockEscolha: BandChoice | null = { deviceId: 'AA:BB', name: 'Mi Band' };
jest.mock('../../../services/telemetry/bluetooth/bluetoothBandChoice', () => ({
  sharedBandChoiceStore: () => ({}),
  useBandChoice: () => mockEscolha,
}));

let mockPerfil: Profile | null = { fullName: 'Trabalhador Teste', birthDate: '25/12/1990' };
jest.mock('../../../services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: mockPerfil }),
}));

jest.mock('../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'func-1' } }),
}));

// O SecureStore em memória: o "Entendi" sobrevive entre montagens como no
// aparelho.
const mockCofre = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockCofre.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockCofre.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockCofre.delete(k);
  }),
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
const CHAVE_ENTENDI = 'swi.readiness.ack.v1.func-1';

const montadas: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    while (montadas.length) montadas.pop()!.unmount();
  });
});

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
  montadas.push(tree);
  return tree;
};

const textos = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props.children === 'string' && typeof n.type !== 'string')
    .map((n) => n.props.children as string);

/** Os passos visíveis, na ordem da tela (um id por linha). */
const passos = (tree: ReactTestRenderer) => [
  ...new Set(
    tree.root
      .findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('readiness-'))
      .map((n) => n.props.testID as string)
      .filter((id) => id !== 'readiness-list'),
  ),
];

const linhaDe = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === `readiness-${id}`)[0];

type BotaoDS = { label: string; onPress: () => void };
const botao = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAllByType(Button as React.ComponentType<BotaoDS>).find((b) => b.props.label === label);

const tocar = async (tree: ReactTestRenderer, label: string) => {
  const b = botao(tree, label);
  expect(b).toBeDefined();
  await act(async () => {
    b!.props.onPress();
  });
};

const temLista = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.props.testID === 'readiness-list').length > 0;

// --- Casos -------------------------------------------------------------------

beforeEach(() => {
  naPlataforma('android');
  mockGate.mockImplementation((gate) => gate === 'healthConnect' || gate === 'bluetoothHeartRate');
  mockPaired = true;
  mockHealthConnect = HC_PRONTO;
  mockEscolha = { deviceId: 'AA:BB', name: 'Mi Band' };
  mockPerfil = { fullName: 'Trabalhador Teste', birthDate: '25/12/1990' };
  mockCofre.clear();
  jest.clearAllMocks();
});

afterAll(() => {
  naPlataforma(originalOS);
});

describe('dashboard: lista de prontidão', () => {
  it('com tudo pronto não há lista, e a linha de estado continua', async () => {
    const tree = await montar();
    expect(temLista(tree)).toBe(false);
    expect(textos(tree)).toContain('Sem leitura do aparelho');
  });

  it('com tudo faltando, mostra os passos na ordem, no lugar da linha de estado', async () => {
    mockPaired = false;
    mockHealthConnect = {
      ...HC_PRONTO,
      availability: 'unavailable',
      permission: null,
      backgroundPermission: null,
      bandPackage: null,
    };
    mockEscolha = null;
    mockPerfil = { fullName: 'Trabalhador Teste' };
    const tree = await montar();

    expect(passos(tree)).toEqual([
      'readiness-PAIR',
      'readiness-HEALTH_CONNECT_INSTALL',
      'readiness-HEALTH_CONNECT_READ',
      'readiness-HEALTH_CONNECT_BACKGROUND',
      'readiness-MANUFACTURER_APP',
      'readiness-BLUETOOTH_BAND',
      'readiness-BIRTH_DATE',
    ]);
    const t = textos(tree);
    expect(t).toContain('Para o monitoramento funcionar');
    expect(t).not.toContain('Sem leitura do aparelho');
    expect(t.join(' ')).not.toMatch(/jornada/i);
    expect(t).toContain('Esforço e desgaste dependem da data de nascimento no seu cadastro.');
  });

  it('mostra só os passos abertos', async () => {
    mockHealthConnect = { ...HC_PRONTO, backgroundPermission: 'denied' };
    const tree = await montar();
    expect(passos(tree)).toEqual(['readiness-HEALTH_CONNECT_BACKGROUND']);
  });

  it('os opcionais vêm marcados como opcionais, e os obrigatórios não', async () => {
    mockHealthConnect = { ...HC_PRONTO, bandPackage: null };
    mockEscolha = null;
    mockPerfil = { fullName: 'Trabalhador Teste' };
    const tree = await montar();
    const etiquetas = (id: string) =>
      linhaDe(tree, id)
        .findAllByType(StatusTag as React.ComponentType<{ label: string }>)
        .map((tag) => tag.props.label);
    expect(etiquetas('MANUFACTURER_APP')).toContain('Opcional');
    expect(etiquetas('BLUETOOTH_BAND')).toContain('Opcional');
    expect(etiquetas('BIRTH_DATE')).not.toContain('Opcional');
  });

  it('não afirma pendência antes de saber: Health Connect e perfil ainda não lidos não abrem a lista', async () => {
    mockHealthConnect = null;
    mockPerfil = null;
    const tree = await montar();
    expect(temLista(tree)).toBe(false);
  });

  it('com obrigatório pendente não há "Entendi"', async () => {
    mockPaired = false;
    const tree = await montar();
    expect(temLista(tree)).toBe(true);
    expect(botao(tree, 'Entendi')).toBeUndefined();
  });

  it('só com opcionais, "Entendi" esconde a lista e o toque vale na próxima abertura', async () => {
    mockEscolha = null;
    const tree = await montar();
    expect(passos(tree)).toEqual(['readiness-BLUETOOTH_BAND']);

    await tocar(tree, 'Entendi');
    expect(temLista(tree)).toBe(false);
    expect(textos(tree)).toContain('Sem leitura do aparelho');
    expect(mockCofre.get(CHAVE_ENTENDI)).toBe('1');

    const outra = await montar();
    expect(temLista(outra)).toBe(false);
  });

  it('a lista volta quando um obrigatório reaparece, e o "Entendi" deixa de valer', async () => {
    mockEscolha = null;
    mockCofre.set(CHAVE_ENTENDI, '1');
    // Permissão revogada nos ajustes do Health Connect.
    mockHealthConnect = { ...HC_PRONTO, permission: 'denied', backgroundPermission: 'denied' };
    const tree = await montar();
    expect(passos(tree)).toEqual([
      'readiness-HEALTH_CONNECT_READ',
      'readiness-HEALTH_CONNECT_BACKGROUND',
      'readiness-BLUETOOTH_BAND',
    ]);
    expect(mockCofre.has(CHAVE_ENTENDI)).toBe(false);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(CHAVE_ENTENDI);

    // Permissão concedida de novo: sobra o opcional, e a lista segue até outro
    // "Entendi".
    mockHealthConnect = HC_PRONTO;
    const depois = await montar();
    expect(passos(depois)).toEqual(['readiness-BLUETOOTH_BAND']);
    expect(botao(depois, 'Entendi')).toBeDefined();
  });

  it('pareamento revogado também traz a lista de volta', async () => {
    mockEscolha = null;
    mockCofre.set(CHAVE_ENTENDI, '1');
    mockPaired = false;
    const tree = await montar();
    expect(passos(tree)).toEqual(['readiness-PAIR', 'readiness-BLUETOOTH_BAND']);
    expect(mockCofre.has(CHAVE_ENTENDI)).toBe(false);
  });

  it('Health Connect desinstalado também traz a lista de volta', async () => {
    mockEscolha = null;
    mockCofre.set(CHAVE_ENTENDI, '1');
    mockHealthConnect = { ...HC_PRONTO, availability: 'unavailable', permission: null, backgroundPermission: null };
    const tree = await montar();
    expect(passos(tree)).toContain('readiness-HEALTH_CONNECT_INSTALL');
    expect(mockCofre.has(CHAVE_ENTENDI)).toBe(false);
  });

  it('confere o Health Connect ao abrir, para a volta dos ajustes atualizar a lista', async () => {
    await montar();
    expect(mockConferir).toHaveBeenCalled();
  });

  describe('cada ação a um toque', () => {
    beforeEach(() => {
      mockPaired = false;
      mockHealthConnect = { ...HC_PRONTO, permission: 'denied', backgroundPermission: 'denied', bandPackage: null };
      mockEscolha = null;
      mockPerfil = { fullName: 'Trabalhador Teste' };
    });

    it('Parear aparelho leva à tela do código', async () => {
      const tree = await montar();
      await tocar(tree, 'Parear aparelho');
      expect(mockPush).toHaveBeenCalledWith('/(onboarding)/watch/pairing?origem=configuracoes');
    });

    it('Permitir leitura abre a folha de permissão do Health Connect', async () => {
      const tree = await montar();
      await tocar(tree, 'Permitir leitura');
      expect(mockPedirPermissao).toHaveBeenCalled();
    });

    it('o segundo plano abre os ajustes do Health Connect', async () => {
      const tree = await montar();
      await tocar(tree, 'Abrir os ajustes do Health Connect');
      expect(mockAbrirAjustes).toHaveBeenCalled();
    });

    it('o app do fabricante abre o guia da pulseira', async () => {
      const tree = await montar();
      await tocar(tree, 'Guia da pulseira');
      expect(mockPush).toHaveBeenCalledWith('/(app)/settings/band-guide');
    });

    it('Escolher a pulseira leva ao Monitoramento, onde a escolha mora', async () => {
      const tree = await montar();
      await tocar(tree, 'Escolher a pulseira');
      expect(mockPush).toHaveBeenCalledWith('/(app)/settings/watch-diagnostics');
    });

    it('Avise o administrador abre o Suporte', async () => {
      const tree = await montar();
      await tocar(tree, 'Avise o administrador');
      expect(mockPush).toHaveBeenCalledWith('/(app)/settings/support');
    });

    it('sem Health Connect atualizado, a Play Store', async () => {
      mockHealthConnect = {
        ...HC_PRONTO,
        availability: 'update_required',
        permission: null,
        backgroundPermission: null,
      };
      const tree = await montar();
      await tocar(tree, 'Abrir a Play Store');
      expect(openHealthConnectInPlayStore).toHaveBeenCalled();
    });
  });

  it('sem o gate do Bluetooth, a pulseira por Bluetooth não é passo', async () => {
    mockGate.mockImplementation((gate) => gate === 'healthConnect');
    mockEscolha = null;
    mockPaired = false;
    const tree = await montar();
    expect(passos(tree)).toEqual(['readiness-PAIR']);
  });

  it('no iPhone não há lista', async () => {
    naPlataforma('ios');
    mockPaired = false;
    const tree = await montar();
    expect(temLista(tree)).toBe(false);
  });
});
