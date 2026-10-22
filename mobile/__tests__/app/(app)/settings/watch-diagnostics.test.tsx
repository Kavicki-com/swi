import { Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, SwiThemeProvider, TopBar } from '@kavicki/swi-design-system';
import WatchDiagnostics from '../../../../app/(app)/settings/watch-diagnostics';
import { HealthConnectMonitoring } from '../../../../components/telemetry/HealthConnectMonitoring';
import { isFeatureEnabled } from '../../../../lib/featureFlags';
import {
  activateMonitoring,
  useWatchDiagnostics,
  type WatchDiagnosticsState,
} from '../../../../services/telemetry/watchDiagnostics';
import { useTelemetryUploadState } from '../../../../services/telemetry/TelemetryUploadProvider';

// Porta de reentrada: quem tocou "Configurar depois" no cadastro, ou negou na
// folha do sistema, volta por aqui. Mesmo vocabulario da tela final do
// primeiro uso (CONTEXT.md).

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));

jest.mock('../../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: jest.fn(),
  activateMonitoring: jest.fn(async () => true),
}));

// O envio mora na raiz do app e tem teste próprio; aqui só o que a tela
// mostra do estado que ele publica.
jest.mock('../../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: jest.fn(),
}));

// O caminho do Health Connect depende do gate e da plataforma, como no
// pareamento. Desligado por padrão: os casos do iPhone não dependem dele.
// A seção da pulseira no Bluetooth tem teste próprio
// (BluetoothHeartRateMonitoring.test.tsx); aqui, só se ela aparece.
const mockSecaoBluetooth = jest.fn((_props: object) => null);
jest.mock('../../../../components/telemetry/BluetoothHeartRateMonitoring', () => ({
  BluetoothHeartRateMonitoring: (props: object) => mockSecaoBluetooth(props),
}));
jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));
const mockGate = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const mockEstado = useWatchDiagnostics as jest.MockedFunction<typeof useWatchDiagnostics>;
const mockAtivar = activateMonitoring as jest.MockedFunction<typeof activateMonitoring>;
const mockEnvio = useTelemetryUploadState as jest.MockedFunction<typeof useTelemetryUploadState>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const agoraMenos = (s: number) => new Date(Date.now() - s * 1000).toISOString();

// As telas mantem um relogio vivo (useNow) para a atualidade envelhecer sem
// evento novo. Arvore nao desmontada deixa esse intervalo rodando depois do
// teste, o que o Jest reporta como log fora de hora.
const montadas: ReturnType<typeof create>[] = [];

afterEach(() => {
  while (montadas.length) montadas.pop()!.unmount();
});

const render = async (state: WatchDiagnosticsState) => {
  mockEstado.mockReturnValue(state);
  let tree!: ReturnType<typeof create>;
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

const textoDe = (tree: ReturnType<typeof create>): string => {
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

const botaoAtivar = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAllByType(Button as React.ComponentType<{ label: string; onPress: () => void }>)
    .find((b) => b.props.label === 'Ativar monitoramento');

const SEM_SUPORTE: WatchDiagnosticsState = { support: 'unsupported' };
const SEM_NADA: WatchDiagnosticsState = {
  support: 'ready',
  session: 'none',
  watchProtocol: null,
  sessionChangedAt: null,
  lastSample: null,
};
const ATIVO = (): WatchDiagnosticsState => ({
  support: 'ready',
  session: 'running',
  watchProtocol: null,
  sessionChangedAt: agoraMenos(60),
  lastSample: { bpm: 72, measuredAt: agoraMenos(5) },
});
const ENCERRADO_COM_LEITURA = (): WatchDiagnosticsState => ({
  support: 'ready',
  session: 'ended',
  watchProtocol: null,
  sessionChangedAt: agoraMenos(30),
  lastSample: { bpm: 65, measuredAt: agoraMenos(10) },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAtivar.mockResolvedValue(true);
  mockEnvio.mockReturnValue({
    paired: false,
    lastOutcome: null,
    refreshPairing: jest.fn(),
    healthConnect: null,
    syncNow: jest.fn(),
    syncing: false,
    requestHealthConnectPermission: jest.fn(),
    checkHealthConnect: jest.fn(),
    openHealthConnectSettings: jest.fn(),
    redetectBand: jest.fn(),
    resetHealthConnectForNewPairing: jest.fn(),
  });
  mockGate.mockReturnValue(false);
});

afterEach(() => {
  naPlataforma(originalOS);
});

describe('Configurações, Monitoramento', () => {
  it('usa a TopBar do DS com o nome que a pessoa foi procurar', async () => {
    const tree = await render(SEM_SUPORTE);
    const topBar = tree.root.findAllByType(TopBar as React.ComponentType<{ title: string }>)[0];
    expect(topBar.props.title).toBe('Monitoramento');
  });

  it('sem suporte explica o motivo real e não oferece ativar', async () => {
    const tree = await render(SEM_SUPORTE);
    expect(textoDe(tree)).toContain('iPhone e Apple Watch');
    expect(botaoAtivar(tree)).toBeUndefined();
  });

  it('sem leitura oferece ativar e aponta o caminho do sistema', async () => {
    const tree = await render(SEM_NADA);
    const t = textoDe(tree);
    expect(t).toContain('Monitoramento indisponível');
    expect(t).toContain('Ajustes');
    expect(botaoAtivar(tree)).toBeDefined();
  });

  it('ativar dispara autorizar e ativar juntos', async () => {
    const tree = await render(SEM_NADA);
    await act(async () => {
      botaoAtivar(tree)!.props.onPress();
    });
    expect(mockAtivar).toHaveBeenCalledTimes(1);
  });

  // Com a sessao ja ativa, ativar de novo nao faria nada: o botao sai.
  it('com sessão ativa o botão some e o BPM real aparece com horário', async () => {
    const tree = await render(ATIVO());
    const t = textoDe(tree);
    expect(t).toContain('72');
    expect(t).toContain('bpm');
    expect(botaoAtivar(tree)).toBeUndefined();
  });

  it('sessão encerrada mantém a última leitura e volta a oferecer ativar', async () => {
    const tree = await render(ENCERRADO_COM_LEITURA());
    expect(textoDe(tree)).toContain('65');
    expect(botaoAtivar(tree)).toBeDefined();
  });

  // Decisao congelada do plano: sem sessao ativa, a ultima leitura permanece
  // visivel com horario. Some-la apagaria o unico dado real que chegou.
  it('leitura antiga demais para contar continua visível com horário', async () => {
    const tree = await render({
      support: 'ready',
      session: 'ended',
      watchProtocol: null,
      sessionChangedAt: agoraMenos(600),
      lastSample: { bpm: 58, measuredAt: agoraMenos(600) },
    });
    const t = textoDe(tree);
    expect(t).toContain('Monitoramento indisponível');
    expect(t).toContain('58');
    expect(t).toContain('medido às');
  });

  it('nunca acusa negação de permissão nem cita smartband', async () => {
    for (const estado of [SEM_SUPORTE, SEM_NADA, ATIVO(), ENCERRADO_COM_LEITURA()]) {
      const t = textoDe(await render(estado)).toLowerCase();
      expect(t).not.toContain('negad');
      expect(t).not.toContain('smartband');
    }
  });

  it('sem leitura não inventa zero', async () => {
    const t = textoDe(await render(SEM_NADA));
    expect(t).not.toMatch(/\b0\s*bpm/i);
  });

  // A linha de envio ao backend. A tela de produto é outra; aqui só a prova
  // de que o caminho existe.
  it('pareado diz que está enviando ao servidor', async () => {
    mockEnvio.mockReturnValue({
      paired: true,
      lastOutcome: null,
      refreshPairing: jest.fn(),
      healthConnect: null,
      syncNow: jest.fn(),
      syncing: false,
      requestHealthConnectPermission: jest.fn(),
      checkHealthConnect: jest.fn(),
      openHealthConnectSettings: jest.fn(),
      redetectBand: jest.fn(),
      resetHealthConnectForNewPairing: jest.fn(),
    });
    expect(textoDe(await render(ATIVO()))).toContain('Enviando ao servidor');
  });

  it('sem pareamento diz que o aparelho não está pareado', async () => {
    expect(textoDe(await render(SEM_NADA))).toContain('Aparelho não pareado');
  });

  it('sem suporte não fala de envio', async () => {
    const t = textoDe(await render(SEM_SUPORTE));
    expect(t).not.toContain('Enviando ao servidor');
    expect(t).not.toContain('Aparelho não pareado');
  });

  const botaoParear = (tree: ReturnType<typeof create>) =>
    tree.root
      .findAllByType(Button as React.ComponentType<{ label: string; onPress: () => void }>)
      .find((b) => b.props.label === 'Parear aparelho');

  it('sem pareamento oferece parear, e o botão leva à tela do código', async () => {
    const tree = await render(SEM_NADA);
    const botao = botaoParear(tree);
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/(onboarding)/watch/pairing?origem=configuracoes');
  });

  it('pareado não oferece parear de novo', async () => {
    mockEnvio.mockReturnValue({
      paired: true,
      lastOutcome: null,
      refreshPairing: jest.fn(),
      healthConnect: null,
      syncNow: jest.fn(),
      syncing: false,
      requestHealthConnectPermission: jest.fn(),
      checkHealthConnect: jest.fn(),
      openHealthConnectSettings: jest.fn(),
      redetectBand: jest.fn(),
      resetHealthConnectForNewPairing: jest.fn(),
    });
    expect(botaoParear(await render(ATIVO()))).toBeUndefined();
  });

  it('sem suporte não oferece parear', async () => {
    expect(botaoParear(await render(SEM_SUPORTE))).toBeUndefined();
  });
});

// No Android com o gate do Health Connect a pulseira grava no Health Connect,
// e o caminho é outro: nada do Apple Watch (o controle dele diz "sem
// suporte" no Android, o que seria falso para quem usa pulseira). O bloco
// tem teste próprio (HealthConnectMonitoring.test.tsx); aqui, a escolha.
describe('Configurações, Monitoramento: Android', () => {
  const ESTADO_HC = {
    availability: 'available' as const,
    permission: 'granted' as const,
    bandPackage: 'com.huami.watch.hmwatchmanager',
    bandLabel: 'Zepp',
    noBand: false,
    lastSyncAt: agoraMenos(180),
  };

  const comEnvioAndroid = (paired: boolean) =>
    mockEnvio.mockReturnValue({
      paired,
      lastOutcome: null,
      refreshPairing: jest.fn(),
      healthConnect: ESTADO_HC,
      syncNow: jest.fn(async () => undefined),
      syncing: false,
      requestHealthConnectPermission: jest.fn(async () => 'granted' as const),
      checkHealthConnect: jest.fn(async () => 'available' as const),
      openHealthConnectSettings: jest.fn(),
      redetectBand: jest.fn(async () => true),
      resetHealthConnectForNewPairing: jest.fn(),
    });

  beforeEach(() => {
    naPlataforma('android');
    mockGate.mockImplementation((gate) => gate === 'healthConnect');
  });

  it('com o gate, mostra o Health Connect no lugar do Apple Watch', async () => {
    comEnvioAndroid(true);
    const tree = await render(SEM_SUPORTE);
    const t = textoDe(tree);
    expect(tree.root.findAllByType(HealthConnectMonitoring)).toHaveLength(1);
    expect(t).toContain('Leitura permitida');
    expect(t).toContain('Pulseira detectada: Zepp');
    expect(t).not.toMatch(/iPhone|Apple Watch|bpm|não faz o monitoramento/i);
    expect(botaoAtivar(tree)).toBeUndefined();
    // O controle do relógio nem é consultado: o caminho dele não roda.
    expect(mockEstado).not.toHaveBeenCalled();
  });

  it('mantém a TopBar e o nome da tela', async () => {
    comEnvioAndroid(true);
    const tree = await render(SEM_SUPORTE);
    const topBar = tree.root.findAllByType(TopBar as React.ComponentType<{ title: string }>)[0];
    expect(topBar.props.title).toBe('Monitoramento');
  });

  it('sem pareamento, Parear aparelho leva à tela do código, vinda de Configurações', async () => {
    comEnvioAndroid(false);
    const tree = await render(SEM_SUPORTE);
    const botao = tree.root
      .findAllByType(Button as React.ComponentType<{ label: string; onPress: () => void }>)
      .find((b) => b.props.label === 'Parear aparelho');
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/(onboarding)/watch/pairing?origem=configuracoes');
  });

  it('com o gate do Bluetooth, a seção da pulseira vem abaixo do Health Connect', async () => {
    mockGate.mockImplementation((gate) => gate === 'healthConnect' || gate === 'bluetoothHeartRate');
    mockSecaoBluetooth.mockClear();
    comEnvioAndroid(true);
    await render(SEM_SUPORTE);
    expect(mockSecaoBluetooth).toHaveBeenCalled();
  });

  it('sem o gate do Bluetooth, a seção da pulseira não aparece', async () => {
    mockSecaoBluetooth.mockClear();
    comEnvioAndroid(true);
    await render(SEM_SUPORTE);
    expect(mockSecaoBluetooth).not.toHaveBeenCalled();
  });

  // Sem o gate (Expo Go, build sem o módulo) não há Health Connect a ler:
  // fica o caminho de sempre, que diz que o aparelho não faz o monitoramento.
  it('sem o gate, segue o caminho de sempre', async () => {
    mockGate.mockReturnValue(false);
    const tree = await render(SEM_SUPORTE);
    expect(tree.root.findAllByType(HealthConnectMonitoring)).toHaveLength(0);
    expect(textoDe(tree)).toContain('iPhone e Apple Watch');
  });
});

// No iPhone o gate do Health Connect nunca liga (só Android compilado), mas
// a plataforma é conferida junto, como no provider e no pareamento.
describe('Configurações, Monitoramento: iPhone com o gate ligado', () => {
  it('segue no Apple Watch', async () => {
    naPlataforma('ios');
    mockGate.mockReturnValue(true);
    const tree = await render(SEM_NADA);
    expect(tree.root.findAllByType(HealthConnectMonitoring)).toHaveLength(0);
    expect(botaoAtivar(tree)).toBeDefined();
  });
});
