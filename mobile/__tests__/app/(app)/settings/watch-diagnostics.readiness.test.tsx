import { Platform, ScrollView } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, Step, StatusTag, SwiThemeProvider } from '@kavicki/swi-design-system';
import WatchDiagnostics from '../../../../app/(app)/settings/watch-diagnostics';
import { isFeatureEnabled } from '../../../../lib/featureFlags';
import type { HealthConnectState } from '../../../../services/telemetry/healthConnect/healthConnectReader';
import type { BandChoice } from '../../../../services/telemetry/bluetooth/bluetoothBandChoice';
import type { Profile } from '../../../../services/profile/types';

// A lista de prontidão completa em Configurações, Monitoramento: sempre, com
// os cumpridos marcados, mesmo depois do "Entendi". A escolha da pulseira por
// Bluetooth mora nesta mesma tela, então o passo dela rola até a seção em vez
// de navegar.

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));

jest.mock('../../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: jest.fn(() => ({ support: 'ready' })),
  activateMonitoring: jest.fn(async () => true),
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
let mockHealthConnect: HealthConnectState | null = HC_PRONTO;
jest.mock('../../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({
    paired: true,
    lastOutcome: null,
    healthConnect: mockHealthConnect,
    syncing: false,
    syncNow: async () => undefined,
    checkHealthConnect: async () => 'available',
    requestHealthConnectPermission: async () => 'granted',
    openHealthConnectSettings: jest.fn(),
  }),
}));

// As seções do Health Connect e da pulseira têm testes próprios; aqui só
// interessa onde a lista fica e para onde ela leva.
jest.mock('../../../../components/telemetry/HealthConnectMonitoring', () => ({
  HealthConnectMonitoring: () => null,
}));
jest.mock('../../../../components/telemetry/BluetoothHeartRateMonitoring', () => ({
  BluetoothHeartRateMonitoring: () => null,
}));

let mockEscolha: BandChoice | null = null;
jest.mock('../../../../services/telemetry/bluetooth/bluetoothBandChoice', () => ({
  sharedBandChoiceStore: () => ({}),
  useBandChoice: () => mockEscolha,
}));

let mockPerfil: Profile | null = { birthDate: '25/12/1990' };
jest.mock('../../../../services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: mockPerfil }),
}));
jest.mock('../../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'func-1' } }),
}));

// O "Entendi" já tocado no dashboard não esconde nada aqui.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => '1'),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));
const mockGate = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

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
          <WatchDiagnostics />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  montadas.push(tree);
  return tree;
};

const linhaDe = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === `readiness-${id}`)[0];

const etiquetas = (tree: ReactTestRenderer, id: string) =>
  linhaDe(tree, id)
    .findAllByType(StatusTag as React.ComponentType<{ label: string }>)
    .map((t) => t.props.label);

const marca = (tree: ReactTestRenderer, id: string) =>
  linhaDe(tree, id).findByType(Step as React.ComponentType<{ state: string }>).props.state;

type BotaoDS = { label: string; onPress: () => void };
const botao = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAllByType(Button as React.ComponentType<BotaoDS>).find((b) => b.props.label === label);

beforeEach(() => {
  naPlataforma('android');
  mockGate.mockImplementation((gate) => gate === 'healthConnect' || gate === 'bluetoothHeartRate');
  mockHealthConnect = HC_PRONTO;
  mockEscolha = null;
  mockPerfil = { birthDate: '25/12/1990' };
  jest.clearAllMocks();
});

afterAll(() => {
  naPlataforma(originalOS);
});

describe('Configurações, Monitoramento: lista de prontidão', () => {
  it('mostra a lista inteira, com os cumpridos marcados e o que falta', async () => {
    const tree = await montar();
    for (const id of [
      'PAIR',
      'HEALTH_CONNECT_INSTALL',
      'HEALTH_CONNECT_READ',
      'HEALTH_CONNECT_BACKGROUND',
      'MANUFACTURER_APP',
      'BIRTH_DATE',
    ]) {
      expect(marca(tree, id)).toBe('done');
      expect(etiquetas(tree, id)).toContain('Feito');
    }
    expect(marca(tree, 'BLUETOOTH_BAND')).toBe('default');
    expect(etiquetas(tree, 'BLUETOOTH_BAND')).toEqual(['Falta', 'Opcional']);
    // Cumprido não tem ação; só o que falta.
    expect(botao(tree, 'Parear aparelho')).toBeUndefined();
    expect(botao(tree, 'Escolher a pulseira')).toBeDefined();
  });

  it('aparece mesmo com o "Entendi" tocado e sem botão "Entendi"', async () => {
    const tree = await montar();
    expect(tree.root.findAll((n) => n.props.testID === 'readiness-list').length).toBeGreaterThan(0);
    expect(botao(tree, 'Entendi')).toBeUndefined();
  });

  it('o que ainda não se sabe aparece como "Conferindo", sem ação', async () => {
    mockHealthConnect = null;
    mockPerfil = null;
    const tree = await montar();
    expect(etiquetas(tree, 'HEALTH_CONNECT_INSTALL')).toEqual(['Conferindo']);
    expect(etiquetas(tree, 'BIRTH_DATE')).toEqual(['Conferindo']);
    expect(botao(tree, 'Abrir a Play Store')).toBeUndefined();
    expect(botao(tree, 'Avise o administrador')).toBeUndefined();
  });

  it('a lista vem antes das seções do Health Connect e da pulseira', async () => {
    const tree = await montar();
    const ids = tree.root
      .findAll((n) => n.props.testID === 'readiness-list' || n.props.testID === 'secao-bluetooth')
      .map((n) => n.props.testID as string);
    expect(ids.indexOf('readiness-list')).toBeLessThan(ids.indexOf('secao-bluetooth'));
  });

  it('Escolher a pulseira rola até a seção da pulseira, nesta tela', async () => {
    const tree = await montar();
    const rolagem = tree.root.findByType(ScrollView).instance as { scrollTo: (o: object) => void };
    const scrollTo = jest.spyOn(rolagem, 'scrollTo').mockImplementation(() => undefined);
    await act(async () => {
      botao(tree, 'Escolher a pulseira')!.props.onPress();
    });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ animated: true }));
    expect(mockPush).not.toHaveBeenCalledWith('/(app)/settings/watch-diagnostics');
  });

  it('as outras ações navegam como no dashboard', async () => {
    mockHealthConnect = { ...HC_PRONTO, bandPackage: null };
    mockPerfil = {};
    const tree = await montar();
    await act(async () => {
      botao(tree, 'Guia da pulseira')!.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/(app)/settings/band-guide');
    await act(async () => {
      botao(tree, 'Avise o administrador')!.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/(app)/settings/support');
  });

  it('no iPhone não há lista', async () => {
    naPlataforma('ios');
    const tree = await montar();
    expect(tree.root.findAll((n) => n.props.testID === 'readiness-list')).toHaveLength(0);
  });
});
