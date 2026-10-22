import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import MyStats from '../../../app/(app)/my-stats';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import type { HealthConnectState } from '../../../services/telemetry/healthConnect/healthConnectReader';
import type { MetricAbsence } from '../../../services/telemetry/myTelemetry';
import { emptySeries } from '../../../services/telemetry/mySeriesFixtures';
import { neverReported, noMetric } from '../../../services/telemetry/myTelemetryFixtures';
import type { WatchDiagnosticsState } from '../../../services/telemetry/watchDiagnostics';
import type { MyTelemetryState } from '../../../services/vitals/MyTelemetryProvider';
import type { MySeriesState } from '../../../services/vitals/useMySeries';

// Vocabulário da ausência em Meu desempenho: as três colunas e os anéis de
// oxigenação, passos e energia dizem por que estão sem valor, com a mesma
// regra do dashboard (dashboard.absence.test.tsx cobre as bordas do Falhou).
// Aqui: cada rótulo nos anéis, o Falhou sobrepondo com um aviso só por
// caminho, o botão, o iPhone e a ausência de "Sem medição".

const AGORA = new Date('2026-10-01T15:00:00').getTime();
const HOJE_14_10 = new Date('2026-10-01T14:10:00');

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

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../../../services/api/exams', () => ({ listExams: async () => [] }));

let mockTelemetryState: MyTelemetryState = { telemetry: null, failed: false, loading: false };
const mockRefreshTelemetry = jest.fn();
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => mockTelemetryState,
  useRefreshMyTelemetry: () => mockRefreshTelemetry,
}));

let mockHealthConnect: HealthConnectState | null = null;
const mockSyncNow = jest.fn(async () => undefined);
jest.mock('../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({
    healthConnect: mockHealthConnect,
    paired: true,
    syncing: false,
    syncNow: mockSyncNow,
  }),
}));

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

const mockSeries: MySeriesState = { series: emptySeries('day', 3), failed: false, loading: false };
jest.mock('../../../services/vitals/useMySeries', () => ({
  useMySeries: () => mockSeries,
}));
jest.mock('../../../services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: null }),
}));
jest.mock('../../../components/NavFABs', () => ({ NavFABs: () => null }));

// --- Leituras ----------------------------------------------------------------

type Qual = 'heartRate' | 'bloodPressure' | 'energy' | 'steps' | 'oxygenSaturation';

const vazia = (unit: string, ausencia: MetricAbsence | null) => ({ ...noMetric<number>(unit), ausencia });

const lendo = (ausencias: Partial<Record<Qual, MetricAbsence>> = {}): MyTelemetryState => {
  const base = neverReported();
  return {
    telemetry: {
      ...base,
      metrics: {
        ...base.metrics,
        heartRate: vazia('bpm', ausencias.heartRate ?? null),
        bloodPressure: { ...noMetric('mmHg'), ausencia: ausencias.bloodPressure ?? null },
        energyRatePerHour: { ...vazia('kcal/h', ausencias.energy ?? null), calculating: false },
        steps: vazia('steps', ausencias.steps ?? null),
        oxygenSaturation: vazia('%', ausencias.oxygenSaturation ?? null),
      },
    },
    failed: false,
    loading: false,
  };
};

const TODAS_AGUARDANDO = {
  heartRate: 'AWAITING',
  bloodPressure: 'AWAITING',
  energy: 'AWAITING',
  steps: 'AWAITING',
  oxygenSaturation: 'AWAITING',
} as const;

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
          <MyStats />
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

/** Os rótulos que os anéis do DS recebem (um por anel). */
const rotulosDosAneis = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => typeof n.props?.progress === 'number' && typeof n.props?.label === 'string')
    .filter((n) => typeof n.type !== 'string')
    .map((n) => n.props.label as string);

const botao = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function')[0];

/** Os caminhos com aviso de falha (o Surface do DS repassa o testID por dentro). */
const avisos = (tree: ReactTestRenderer) => [
  ...new Set(
    tree.root
      .findAll((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('failure-notice-'))
      .map((n) => n.props.testID as string),
  ),
];

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
  mockTelemetryState = lendo(TODAS_AGUARDANDO);
  mockHealthConnect = healthConnect();
  mockEscuta = 'idle';
  mockTrechos = [];
  mockPulseira = null;
});

afterEach(() => {
  naPlataforma(originalOS);
  jest.restoreAllMocks();
});

describe('Meu desempenho: Aguardando e Não envia', () => {
  it('aguardando: colunas e anéis dizem leitura ou medição', async () => {
    const tree = await render();
    const t = textos(tree);
    expect(t).toContain('Aguardando leitura');
    expect(t).toContain('Aguardando medição');
    expect(rotulosDosAneis(tree)).toEqual(
      expect.arrayContaining(['Aguardando medição', 'Aguardando leitura']),
    );
    naoDizSemMedicao(tree);
    expect(t).not.toContain('Indisponível');
  });

  it.each([
    ['oxygenSaturation', 'Esta pulseira não envia oxigenação'],
    ['steps', 'Esta pulseira não envia passos'],
    ['energy', 'Esta pulseira não envia energia'],
  ] as const)('anel que não chega (%s): "%s"', async (qual, rotulo) => {
    mockTelemetryState = lendo({ ...TODAS_AGUARDANDO, [qual]: 'NOT_SENT' });
    const tree = await render();
    expect(rotulosDosAneis(tree)).toContain(rotulo);
  });

  it('pressão que não chega diz isso na coluna', async () => {
    mockTelemetryState = lendo({ ...TODAS_AGUARDANDO, bloodPressure: 'NOT_SENT' });
    const tree = await render();
    expect(textos(tree)).toContain('Esta pulseira não envia pressão');
  });

  it('o gráfico sem nada fala de medição sem dizer "Sem medição"', async () => {
    const tree = await render();
    expect(textos(tree)).toContain('Nenhuma medição no período');
    naoDizSemMedicao(tree);
  });
});

describe('Meu desempenho: Falhou no Android', () => {
  it('a falha do Health Connect sobrepõe tudo, com um aviso só e o botão', async () => {
    mockTelemetryState = lendo({ ...TODAS_AGUARDANDO, steps: 'NOT_SENT' });
    mockHealthConnect = healthConnect({
      lastFailureReason: 'permission_denied',
      lastFailureAt: HOJE_14_10.toISOString(),
    });
    const tree = await render();

    expect(rotulosDosAneis(tree)).toEqual(
      expect.arrayContaining(Array(3).fill('Sincronização falhou às 14:10')),
    );
    const t = textos(tree);
    expect(t).not.toContain('Aguardando leitura');
    expect(t).not.toContain('Esta pulseira não envia passos');
    expect(t).toContain('Permissão de leitura do Health Connect negada.');
    expect(avisos(tree)).toHaveLength(1);

    await act(async () => {
      botao(tree, 'Sincronizar agora').props.onPress();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(mockRefreshTelemetry).toHaveBeenCalledTimes(1);
  });

  it('a pulseira desconectada derruba só o batimento e religa a escuta', async () => {
    mockPulseira = { deviceId: 'AA:01', name: 'Band' };
    mockEscuta = 'searching';
    mockTrechos = [{ start: HOJE_14_10.getTime() - 60_000, end: HOJE_14_10.getTime() }];
    const tree = await render();

    const t = textos(tree);
    expect(t).toContain('Pulseira desconectada desde 14:10');
    expect(t).toContain('Pulseira fora do alcance ou desligada.');
    expect(rotulosDosAneis(tree)).not.toContain('Pulseira desconectada desde 14:10');

    await act(async () => {
      botao(tree, 'Religar a escuta').props.onPress();
    });
    expect(mockStart).toHaveBeenCalledWith('AA:01');
  });
});

describe('Meu desempenho: iPhone (ADR-0004)', () => {
  beforeEach(() => {
    naPlataforma('ios');
    mockGate.mockImplementation(gateReal);
    mockHealthConnect = null;
    mockTelemetryState = lendo();
  });

  it('com a sessão espelhada ativa, Aguardando', async () => {
    mockSuporte = { support: 'ready', session: 'running' } as WatchDiagnosticsState;
    const tree = await render();
    expect(textos(tree)).toContain('Aguardando medição');
    expect(textos(tree)).not.toContain('Indisponível');
  });

  it('sem a sessão, "Indisponível" sem motivo e sem aviso', async () => {
    mockSuporte = { support: 'ready', session: 'none' } as WatchDiagnosticsState;
    const tree = await render();
    expect(rotulosDosAneis(tree).filter((r) => r === 'Indisponível')).toHaveLength(3);
    expect(avisos(tree)).toHaveLength(0);
    naoDizSemMedicao(tree);
  });
});
