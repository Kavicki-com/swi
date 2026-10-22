import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Dashboard from '../../../app/(app)/dashboard';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import * as http from '../../../services/api/http';
import type { HealthConnectState } from '../../../services/telemetry/healthConnect/healthConnectReader';
import {
  fetchMyTelemetry,
  type MetricAbsence,
  type WorkerTelemetry,
} from '../../../services/telemetry/myTelemetry';
import { metric, neverReported, noMetric } from '../../../services/telemetry/myTelemetryFixtures';
import type { WatchDiagnosticsState } from '../../../services/telemetry/watchDiagnostics';
import type { MyTelemetryState } from '../../../services/vitals/MyTelemetryProvider';

// Vocabulário da ausência no dashboard: cada coluna (BPM, pressão, Kcal/hora)
// diz por que está sem valor. Aguardando e Não envia vêm da leitura do
// backend; Falhou vem do estado local no Android (última rodada do Health
// Connect, escuta da pulseira) e sobrepõe os dois, com o aviso de motivo e o
// botão. No iPhone, "Aguardando" com a sessão espelhada e "Indisponível" sem.
// "Sem medição" não aparece nunca.

// --- Relógio -----------------------------------------------------------------

// Horários locais, para o teste valer em qualquer fuso.
const AGORA = new Date('2026-10-01T15:00:00').getTime();
const HOJE_14_10 = new Date('2026-10-01T14:10:00');
const ONTEM_09_05 = new Date('2026-09-30T09:05:00');

// --- Fronteiras dubladas -----------------------------------------------------

let mockSuporte: WatchDiagnosticsState = { support: 'unsupported' };
jest.mock('../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: () => mockSuporte,
}));

jest.mock('../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));
const mockGate = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;
const { isFeatureEnabled: gateReal } = jest.requireActual('../../../lib/featureFlags');
const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

let mockTelemetryState: MyTelemetryState = { telemetry: null, failed: false, loading: false };
const mockRefreshTelemetry = jest.fn();
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => mockTelemetryState,
  useRefreshMyTelemetry: () => mockRefreshTelemetry,
}));

// O envio da telemetria: o estado do leitor do Health Connect, com a última
// rodada que falhou, e a sincronização pedida.
let mockHealthConnect: HealthConnectState | null = null;
let mockPareado = true;
const mockSyncNow = jest.fn(async () => undefined);
jest.mock('../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({
    healthConnect: mockHealthConnect,
    paired: mockPareado,
    syncing: false,
    syncNow: mockSyncNow,
  }),
}));

// A ponte do Bluetooth: o estado da escuta e desde quando (fim do último
// trecho conectado), e o `start` que o "Religar a escuta" chama.
let mockEscuta: 'idle' | 'searching' | 'connected' | 'bluetoothOff' = 'idle';
let mockTrechos: { start: number; end: number | null }[] = [];
const mockStart = jest.fn(async (_deviceId: string) => undefined);
jest.mock('../../../modules/swi-ble-heart-rate/src', () => ({
  ...jest.requireActual('../../../modules/swi-ble-heart-rate/src'),
  bleHeartRate: {
    supported: true,
    scan: async () => undefined,
    stopScan: () => undefined,
    start: (deviceId: string) => mockStart(deviceId),
    stop: async () => undefined,
    rotateReadings: () => [],
    connectedIntervals: () => mockTrechos,
    status: () => ({ state: mockEscuta, deviceId: 'AA:01', lastReadingAt: null }),
    onScanResult: () => () => undefined,
    onStateChanged: () => () => undefined,
  },
}));

let mockPulseira: { deviceId: string; name: string | null } | null = null;
jest.mock('../../../services/telemetry/bluetooth/bluetoothBandChoice', () => ({
  ...jest.requireActual('../../../services/telemetry/bluetooth/bluetoothBandChoice'),
  sharedBandChoiceStore: () => ({}),
  useBandChoice: () => mockPulseira,
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
jest.mock('../../../services/live/useLiveBroadcast', () => ({
  useLiveBroadcast: () => ({ live: false, notice: null, toggle: jest.fn(), dismissNotice: jest.fn() }),
}));
jest.mock('../../../components/NavFABs', () => ({ NavFABs: () => null }));
// A lista de prontidão tem suíte própria; aqui ela deixa passar a linha.
jest.mock('../../../components/telemetry/ReadinessList', () => ({
  DashboardReadiness: ({ children }: { children: unknown }) => children,
}));

// --- Leituras ----------------------------------------------------------------

const vazia = <T,>(unit: string, ausencia: MetricAbsence | null) => ({ ...noMetric<T>(unit), ausencia });

/** A leitura do primeiro minuto: nada chegou, e o backend diz por quê. */
const lendo = (
  ausencias: { heartRate?: MetricAbsence; bloodPressure?: MetricAbsence; energy?: MetricAbsence } = {},
  over: Partial<WorkerTelemetry['metrics']> = {},
): MyTelemetryState => {
  const base = neverReported();
  return {
    telemetry: {
      ...base,
      // Com algum valor medido o funcionário já reportou.
      origin: Object.keys(over).length > 0 ? 'REAL' : null,
      metrics: {
        ...base.metrics,
        heartRate: vazia('bpm', ausencias.heartRate ?? null),
        bloodPressure: vazia('mmHg', ausencias.bloodPressure ?? null),
        energyRatePerHour: { ...vazia<number>('kcal/h', ausencias.energy ?? null), calculating: false },
        ...over,
      },
    },
    failed: false,
    loading: false,
  };
};

const AGUARDANDO = { heartRate: 'AWAITING', bloodPressure: 'AWAITING', energy: 'AWAITING' } as const;

const healthConnect = (over: Partial<HealthConnectState> = {}): HealthConnectState => ({
  availability: 'available',
  permission: 'granted',
  backgroundPermission: 'granted',
  bandPackage: null,
  bandLabel: null,
  noBand: false,
  lastSyncAt: null,
  lastFailureReason: null,
  lastFailureAt: null,
  ...over,
});

const falhouAs = (reason: HealthConnectState['lastFailureReason'], at: Date) =>
  healthConnect({ lastFailureReason: reason, lastFailureAt: at.toISOString() });

// --- Helpers -----------------------------------------------------------------

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = async () => {
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

const textos = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

/** Quantos textos na tela (nós de texto do host) dizem exatamente isto. */
const vezes = (tree: ReactTestRenderer, texto: string) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props?.children === texto).length;

const botao = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function')[0];

const aviso = (tree: ReactTestRenderer, caminho: 'healthConnect' | 'bluetooth') =>
  tree.root.findAll((n) => n.props?.testID === `failure-notice-${caminho}`)[0];

const naoDizSemMedicao = (tree: ReactTestRenderer) => {
  for (const t of textos(tree)) expect(t).not.toMatch(/sem medição/i);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(AGORA);
  naPlataforma('android');
  mockGate.mockImplementation(
    (flag) => flag === 'healthConnect' || flag === 'bluetoothHeartRate' || gateReal(flag),
  );
  mockSuporte = { support: 'unsupported' };
  mockTelemetryState = lendo(AGUARDANDO);
  mockHealthConnect = healthConnect();
  mockPareado = true;
  mockEscuta = 'idle';
  mockTrechos = [];
  mockPulseira = null;
});

afterEach(() => {
  naPlataforma(originalOS);
  jest.restoreAllMocks();
});

// --- Casos -------------------------------------------------------------------

describe('dashboard: Aguardando e Não envia, como o backend decidiu', () => {
  it('aguardando: leitura para batimento e energia, medição para pressão', async () => {
    const tree = await render();
    expect(vezes(tree, 'Aguardando leitura')).toBe(2);
    expect(vezes(tree, 'Aguardando medição')).toBe(1);
    // O cartão nunca é escondido: as três colunas seguem com o "--".
    expect(vezes(tree, '--')).toBe(3);
    naoDizSemMedicao(tree);
    expect(textos(tree)).not.toContain('Indisponível');
  });

  it('o leitor interpreta a ausência da resposta do backend', async () => {
    const base = lendo().telemetry!;
    const corpo = {
      ...base,
      metrics: {
        ...base.metrics,
        bloodPressure: { ...noMetric('mmHg'), ausencia: 'NOT_SENT' },
        heartRate: { ...noMetric('bpm'), ausencia: 'AWAITING' },
        energyRatePerHour: { ...noMetric('kcal/h'), calculating: false, ausencia: 'torto' },
      },
    };
    jest.spyOn(http, 'apiRequest').mockResolvedValueOnce(corpo);
    mockTelemetryState = { telemetry: await fetchMyTelemetry(), failed: false, loading: false };
    const tree = await render();
    expect(textos(tree)).toContain('Esta pulseira não envia pressão');
    expect(textos(tree)).toContain('Aguardando leitura');
    // Ausência torta vira "o backend não disse": o rótulo de sempre.
    expect(textos(tree)).toContain('Kcal/hora');
  });

  it.each([
    ['heartRate', 'Esta pulseira não envia batimento'],
    ['bloodPressure', 'Esta pulseira não envia pressão'],
    ['energy', 'Esta pulseira não envia energia'],
  ] as const)('não envia (%s): "%s", com o cartão na tela', async (qual, rotulo) => {
    mockTelemetryState = lendo({ ...AGUARDANDO, [qual]: 'NOT_SENT' });
    const tree = await render();
    expect(textos(tree)).toContain(rotulo);
    expect(vezes(tree, '--')).toBe(3);
  });

  it('volta a valor na primeira leitura', async () => {
    mockTelemetryState = lendo(
      { energy: 'NOT_SENT' },
      {
        heartRate: metric(72, { source: 'HEALTH_CONNECT' }),
        bloodPressure: metric({ systolic: 120, diastolic: 80 }, { source: 'HEALTH_CONNECT' }),
      },
    );
    const tree = await render();
    const t = textos(tree);
    expect(t).toContain('72');
    expect(t).toContain('BPM');
    expect(t).toContain('120/80');
    expect(t).not.toContain('Esta pulseira não envia pressão');
    expect(t).toContain('Esta pulseira não envia energia');
  });

  // Sem caminho ativo o backend não diz nada: no Android nunca vira
  // "Indisponível", e quem explica o que falta é a lista de prontidão.
  it('Android sem caminho ativo fica com os rótulos de sempre, nunca "Indisponível"', async () => {
    mockTelemetryState = lendo();
    const tree = await render();
    const t = textos(tree);
    expect(t).toEqual(expect.arrayContaining(['BPM', 'mmHg', 'Kcal/hora']));
    expect(t).not.toContain('Indisponível');
    naoDizSemMedicao(tree);
  });
});

describe('dashboard: Falhou no Android, pelo estado local', () => {
  it('última rodada do Health Connect com erro sobrepõe Aguardando e Não envia nas três', async () => {
    mockTelemetryState = lendo({ ...AGUARDANDO, bloodPressure: 'NOT_SENT' });
    mockHealthConnect = falhouAs('permission_denied', HOJE_14_10);
    const tree = await render();

    // Três colunas mais o título do aviso.
    expect(vezes(tree, 'Sincronização falhou às 14:10')).toBe(4);
    const t = textos(tree);
    expect(t).not.toContain('Aguardando leitura');
    expect(t).not.toContain('Esta pulseira não envia pressão');
    expect(t).toContain('Permissão de leitura do Health Connect negada.');
    expect(aviso(tree, 'healthConnect')).toBeDefined();
  });

  it.each([
    ['unavailable', 'Health Connect não instalado neste celular.'],
    ['update_required', 'Health Connect desatualizado.'],
    ['other', 'Erro ao ler o Health Connect.'],
  ] as const)('afirma o motivo (%s)', async (reason, motivo) => {
    mockHealthConnect = falhouAs(reason, HOJE_14_10);
    const tree = await render();
    expect(textos(tree)).toContain(motivo);
  });

  it('o botão sincroniza agora e relê a leitura', async () => {
    mockHealthConnect = falhouAs('other', HOJE_14_10);
    const tree = await render();
    await act(async () => {
      botao(tree, 'Sincronizar agora').props.onPress();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(mockRefreshTelemetry).toHaveBeenCalledTimes(1);
  });

  it('sem pareamento o aviso fica, sem o botão que não subiria nada', async () => {
    mockHealthConnect = falhouAs('other', HOJE_14_10);
    mockPareado = false;
    const tree = await render();
    expect(aviso(tree, 'healthConnect')).toBeDefined();
    expect(botao(tree, 'Sincronizar agora')).toBeUndefined();
  });

  it('falha de outro dia leva a data', async () => {
    mockHealthConnect = falhouAs('other', ONTEM_09_05);
    const tree = await render();
    expect(textos(tree)).toContain('Sincronização falhou em 30/09 às 09:05');
  });

  it('pulseira desconectada derruba só o batimento, com a hora e o religar', async () => {
    mockPulseira = { deviceId: 'AA:01', name: 'Band' };
    mockEscuta = 'searching';
    mockTrechos = [{ start: HOJE_14_10.getTime() - 60_000, end: HOJE_14_10.getTime() }];
    const tree = await render();

    expect(vezes(tree, 'Pulseira desconectada desde 14:10')).toBe(2); // coluna e aviso
    const t = textos(tree);
    expect(t).toContain('Pulseira fora do alcance ou desligada.');
    expect(t).toContain('Aguardando medição');
    expect(t).toContain('Aguardando leitura'); // energia, que vem do Health Connect
    expect(aviso(tree, 'healthConnect')).toBeUndefined();

    await act(async () => {
      botao(tree, 'Religar a escuta').props.onPress();
    });
    expect(mockStart).toHaveBeenCalledWith('AA:01');
  });

  it('Bluetooth do celular desligado é afirmado', async () => {
    mockPulseira = { deviceId: 'AA:01', name: 'Band' };
    mockEscuta = 'bluetoothOff';
    mockTrechos = [{ start: HOJE_14_10.getTime() - 60_000, end: HOJE_14_10.getTime() }];
    const tree = await render();
    expect(textos(tree)).toContain('Bluetooth do celular desligado.');
    expect(textos(tree)).toContain('Pulseira desconectada desde 14:10');
  });

  it('com a escuta conectada o batimento aguarda, mesmo com o Health Connect falhando', async () => {
    mockPulseira = { deviceId: 'AA:01', name: 'Band' };
    mockEscuta = 'connected';
    mockHealthConnect = falhouAs('other', HOJE_14_10);
    const tree = await render();
    expect(textos(tree)).toContain('Aguardando leitura');
    // Pressão e energia são do Health Connect: coluna, coluna e aviso.
    expect(vezes(tree, 'Sincronização falhou às 14:10')).toBe(3);
  });

  it('com as métricas de pé não há aviso, mesmo com a falha', async () => {
    mockTelemetryState = lendo(
      {},
      {
        heartRate: metric(72, { source: 'HEALTH_CONNECT' }),
        bloodPressure: metric({ systolic: 120, diastolic: 80 }, { source: 'HEALTH_CONNECT' }),
        energyRatePerHour: { ...metric(310, { source: 'HEALTH_CONNECT' }), calculating: false },
      },
    );
    mockHealthConnect = falhouAs('other', HOJE_14_10);
    const tree = await render();
    expect(aviso(tree, 'healthConnect')).toBeUndefined();
    expect(textos(tree)).not.toContain('Sincronização falhou às 14:10');
  });
});

describe('dashboard: iPhone (ADR-0004)', () => {
  beforeEach(() => {
    naPlataforma('ios');
    mockGate.mockImplementation(gateReal);
    mockHealthConnect = null;
    mockTelemetryState = lendo();
  });

  const relogio = (session: 'running' | 'none'): WatchDiagnosticsState =>
    ({ support: 'ready', session }) as WatchDiagnosticsState;

  it('com a sessão espelhada ativa, Aguardando', async () => {
    mockSuporte = relogio('running');
    const tree = await render();
    expect(vezes(tree, 'Aguardando leitura')).toBe(2);
    expect(vezes(tree, 'Aguardando medição')).toBe(1);
    expect(textos(tree)).not.toContain('Indisponível');
  });

  it('sem a sessão, "Indisponível" sem motivo e sem botão', async () => {
    mockSuporte = relogio('none');
    const tree = await render();
    expect(vezes(tree, 'Indisponível')).toBe(3);
    expect(aviso(tree, 'healthConnect')).toBeUndefined();
    expect(aviso(tree, 'bluetooth')).toBeUndefined();
    expect(botao(tree, 'Sincronizar agora')).toBeUndefined();
    naoDizSemMedicao(tree);
  });
});
