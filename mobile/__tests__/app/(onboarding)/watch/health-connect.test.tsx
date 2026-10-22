import { Linking, Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { Button, StatusTag, StepBar, SwiThemeProvider } from '@kavicki/swi-design-system';
import WatchHealthConnect from '../../../../app/(onboarding)/watch/health-connect';
import { isFeatureEnabled, type FeatureGate } from '../../../../lib/featureFlags';
import type { HealthConnectState } from '../../../../services/telemetry/healthConnect/healthConnectReader';
import {
  useTelemetryUploadState,
  type TelemetryUploadContextValue,
} from '../../../../services/telemetry/TelemetryUploadProvider';

// Segunda etapa do primeiro uso no Android (ADR-0013): o Health Connect, o
// caminho base, com os três passos na ordem (instalar ou atualizar, permitir
// a leitura, permitir em segundo plano). Vem depois do pareamento, mesmo de
// quem tocou "Parear depois", e antes da pulseira por Bluetooth.

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));

jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));

jest.mock('../../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: jest.fn(),
}));

const mockGate = isFeatureEnabled as jest.Mock;
const mockEnvio = useTelemetryUploadState as jest.MockedFunction<typeof useTelemetryUploadState>;
const mockRedirect = Redirect as unknown as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const mockSyncNow = jest.fn(async () => undefined);
const mockPedir = jest.fn(
  async (): Promise<'granted' | 'denied' | 'unavailable'> => 'granted',
);
const mockConferir = jest.fn(
  async (): Promise<'available' | 'unavailable' | 'update_required'> => 'available',
);
const mockAjustes = jest.fn();

const estadoHC = (parcial: Partial<HealthConnectState> = {}): HealthConnectState => ({
  availability: 'available',
  permission: null,
  backgroundPermission: null,
  bandPackage: null,
  bandLabel: null,
  noBand: false,
  lastSyncAt: null,
  ...parcial,
});

const TUDO_CONCEDIDO = { permission: 'granted', backgroundPermission: 'granted' } as const;

const comEnvio = (parcial: Partial<TelemetryUploadContextValue> = {}) =>
  mockEnvio.mockReturnValue({
    paired: true,
    lastOutcome: null,
    refreshPairing: jest.fn(),
    healthConnect: null,
    syncNow: mockSyncNow,
    syncing: false,
    requestHealthConnectPermission: mockPedir,
    checkHealthConnect: mockConferir,
    openHealthConnectSettings: mockAjustes,
    redetectBand: jest.fn(async () => true),
    resetHealthConnectForNewPairing: jest.fn(async () => true),
    ...parcial,
  });

const comGates = (...ligados: FeatureGate[]) =>
  mockGate.mockImplementation((gate: FeatureGate) => ligados.includes(gate));

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const montadas: ReturnType<typeof create>[] = [];
afterEach(async () => {
  await act(async () => {
    while (montadas.length) montadas.pop()!.unmount();
  });
  naPlataforma(originalOS);
  jest.restoreAllMocks();
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <WatchHealthConnect />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  montadas.push(tree);
  return tree;
};

const texto = (tree: ReturnType<typeof create>): string => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join(' ');
};

type BotaoProps = { label: string; onPress: () => void; disabled?: boolean };
const botoes = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(Button as React.ComponentType<BotaoProps>);
const botao = (tree: ReturnType<typeof create>, label: string) =>
  botoes(tree).find((b) => b.props.label === label);
const tocar = async (tree: ReturnType<typeof create>, label: string) => {
  const alvo = botao(tree, label);
  if (!alvo) {
    throw new Error(
      `Botão "${label}" não existe. Há: ${botoes(tree)
        .map((b) => b.props.label)
        .join(', ')}`,
    );
  }
  await act(async () => {
    alvo.props.onPress();
  });
};

type TagProps = { label?: string; status?: string };
const tags = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAllByType(StatusTag as React.ComponentType<TagProps>)
    .map((t) => ({ label: t.props.label, status: t.props.status }));

/** Os passos na ordem em que aparecem, cada um com a etiqueta logo depois. */
const PASSOS = [
  'Instalar ou atualizar o Health Connect',
  'Permitir a leitura',
  'Permitir a leitura em segundo plano',
];
const posicoes = (tree: ReturnType<typeof create>) => {
  const t = texto(tree);
  return PASSOS.map((passo) => t.indexOf(passo));
};

/** As três primeiras etiquetas são as dos passos, na mesma ordem. */
const etiquetasDosPassos = (tree: ReturnType<typeof create>) =>
  tags(tree)
    .slice(0, 3)
    .map((t) => t.label);

beforeEach(() => {
  jest.clearAllMocks();
  naPlataforma('android');
  comGates('watchOnboarding', 'healthConnect', 'bluetoothHeartRate');
  mockSyncNow.mockReset().mockResolvedValue(undefined);
  mockPedir.mockReset().mockResolvedValue('granted');
  mockConferir.mockReset().mockResolvedValue('available');
  comEnvio();
});

describe('primeiro uso, Health Connect: ordem', () => {
  it('é a segunda de três etapas, depois do pareamento e antes da pulseira', async () => {
    const tree = await render();
    expect(tree.root.findByType(StepBar).props).toMatchObject({ total: 3, current: 2 });
  });

  it('sem o gate do Bluetooth, é a segunda de duas', async () => {
    comGates('watchOnboarding', 'healthConnect');
    const tree = await render();
    expect(tree.root.findByType(StepBar).props).toMatchObject({ total: 2, current: 2 });
  });

  it('mostra os três passos do Health Connect na ordem', async () => {
    comEnvio({ healthConnect: estadoHC() });
    const tree = await render();
    const [instalar, ler, segundoPlano] = posicoes(tree);
    expect(instalar).toBeGreaterThanOrEqual(0);
    expect(ler).toBeGreaterThan(instalar!);
    expect(segundoPlano).toBeGreaterThan(ler!);
  });

  it('confere o acesso ao Health Connect ao entrar', async () => {
    await render();
    expect(mockConferir).toHaveBeenCalled();
  });
});

describe('primeiro uso, Health Connect: estado de cada passo', () => {
  it('antes de conferir, nada se afirma', async () => {
    const tree = await render();
    expect(etiquetasDosPassos(tree)).toEqual(['Conferindo', 'Conferindo', 'Conferindo']);
  });

  it('sem Health Connect, os três faltam e a ação é a Play Store', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    comEnvio({ healthConnect: estadoHC({ availability: 'unavailable' }) });
    const tree = await render();
    expect(etiquetasDosPassos(tree)).toEqual(['Falta', 'Falta', 'Falta']);
    await tocar(tree, 'Instalar o Health Connect');
    expect(abrir).toHaveBeenCalledWith('market://details?id=com.google.android.apps.healthdata');
  });

  it('Health Connect desatualizado oferece atualizar', async () => {
    comEnvio({ healthConnect: estadoHC({ availability: 'update_required' }) });
    const tree = await render();
    expect(etiquetasDosPassos(tree)[0]).toBe('Falta');
    expect(botao(tree, 'Atualizar o Health Connect')).toBeDefined();
  });

  it('instalado sem permissão: Permitir leitura abre o pedido do sistema', async () => {
    comEnvio({
      healthConnect: estadoHC({ permission: 'denied', backgroundPermission: 'denied' }),
    });
    const tree = await render();
    expect(etiquetasDosPassos(tree)).toEqual(['Feito', 'Falta', 'Falta']);
    await tocar(tree, 'Permitir leitura');
    expect(mockPedir).toHaveBeenCalledTimes(1);
  });

  it('leitura permitida sem o segundo plano: diz o que falta e abre os ajustes', async () => {
    comEnvio({
      healthConnect: estadoHC({ permission: 'granted', backgroundPermission: 'denied' }),
    });
    const tree = await render();
    expect(etiquetasDosPassos(tree)).toEqual(['Feito', 'Feito', 'Falta']);
    expect(texto(tree)).toContain('permita também a leitura em segundo plano');
    await tocar(tree, 'Abrir os ajustes do Health Connect');
    expect(mockAjustes).toHaveBeenCalledTimes(1);
  });

  it('tudo concedido: os três feitos, sem conselho de segundo plano', async () => {
    comEnvio({ healthConnect: estadoHC(TUDO_CONCEDIDO) });
    const tree = await render();
    expect(etiquetasDosPassos(tree)).toEqual(['Feito', 'Feito', 'Feito']);
    expect(texto(tree)).not.toContain('permita também a leitura em segundo plano');
  });
});

describe('primeiro uso, Health Connect: seguir', () => {
  it('com a leitura permitida, Continuar segue para a pulseira por Bluetooth', async () => {
    comEnvio({ healthConnect: estadoHC(TUDO_CONCEDIDO) });
    const tree = await render();
    expect(botao(tree, 'Configurar depois')).toBeUndefined();
    await tocar(tree, 'Continuar');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/bluetooth');
  });

  it('sem o gate do Bluetooth, Continuar vai ao fim do primeiro uso', async () => {
    comGates('watchOnboarding', 'healthConnect');
    comEnvio({ healthConnect: estadoHC(TUDO_CONCEDIDO) });
    const tree = await render();
    await tocar(tree, 'Continuar');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/complete');
  });

  // Configurar depois não é negação: não abre pedido, não abre ajustes, não
  // grava nada, só segue.
  it('Configurar depois segue para a pulseira sem pedir nem registrar nada', async () => {
    comEnvio({ healthConnect: estadoHC({ permission: 'denied' }) });
    const tree = await render();
    expect(botao(tree, 'Continuar')).toBeUndefined();
    await tocar(tree, 'Configurar depois');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/bluetooth');
    expect(mockPedir).not.toHaveBeenCalled();
    expect(mockAjustes).not.toHaveBeenCalled();
    expect(mockSyncNow).not.toHaveBeenCalled();
  });

  it('sem Health Connect, Configurar depois também segue', async () => {
    comEnvio({ healthConnect: estadoHC({ availability: 'unavailable' }) });
    const tree = await render();
    await tocar(tree, 'Configurar depois');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/bluetooth');
  });
});

describe('primeiro uso, Health Connect: quem tocou Parear depois', () => {
  // A primeira sincronização espera o pareamento: sem ele, a tela não fica
  // procurando uma pulseira para sempre.
  it('leitura permitida sem pareamento não sincroniza e diz onde parear', async () => {
    comEnvio({ paired: false, healthConnect: estadoHC(TUDO_CONCEDIDO) });
    const tree = await render();
    expect(mockSyncNow).not.toHaveBeenCalled();
    expect(tags(tree).map((t) => t.label)).not.toContain(
      'Procurando a pulseira no Health Connect…',
    );
    expect(texto(tree)).toContain('depois de parear o celular em Configurações, Monitoramento');
  });

  it('pareado com a leitura permitida, sincroniza uma vez', async () => {
    comEnvio({ healthConnect: estadoHC(TUDO_CONCEDIDO) });
    await render();
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
  });
});

describe('primeiro uso, Health Connect: o que a tela promete', () => {
  it('as medições vêm do Health Connect, com a hora', async () => {
    comEnvio({ healthConnect: estadoHC() });
    const tree = await render();
    expect(texto(tree)).toContain('passos, energia, oxigenação, pressão e batimento');
    expect(texto(tree)).toContain('com a hora em que foram medidas');
  });

  it('não promete movimento ao vivo em nenhum estado', async () => {
    const estados: (HealthConnectState | null)[] = [
      null,
      estadoHC({ availability: 'unavailable' }),
      estadoHC({ permission: 'denied' }),
      estadoHC({ permission: 'granted', backgroundPermission: 'denied' }),
      estadoHC({
        ...TUDO_CONCEDIDO,
        bandLabel: 'Zepp',
        bandPackage: 'com.huami.watch.hmwatchmanager',
      }),
    ];
    for (const healthConnect of estados) {
      comEnvio({ healthConnect });
      const tree = await render();
      expect(texto(tree)).not.toMatch(/ao vivo|tempo real/i);
    }
  });
});

describe('primeiro uso, Health Connect: fora do Android', () => {
  it('no iPhone, não mostra nada do Health Connect e vai ao fim', async () => {
    naPlataforma('ios');
    comGates('watchOnboarding', 'appleWatchPilot', 'healthConnect');
    const tree = await render();
    expect(texto(tree)).not.toContain('Health Connect');
    expect(mockRedirect.mock.calls[0]![0]).toEqual({ href: '/(onboarding)/watch/complete' });
    expect(mockConferir).not.toHaveBeenCalled();
  });

  it('sem o gate do Health Connect, vai ao fim', async () => {
    comGates('watchOnboarding');
    await render();
    expect(mockRedirect.mock.calls[0]![0]).toEqual({ href: '/(onboarding)/watch/complete' });
  });

  it('atrás do portão do primeiro uso', async () => {
    comGates('healthConnect');
    const tree = await render();
    expect(texto(tree)).not.toContain('Health Connect');
    expect(mockGate).toHaveBeenCalledWith('watchOnboarding');
  });
});
