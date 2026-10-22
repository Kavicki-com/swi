import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { isFeatureEnabled } from '../../lib/featureFlags';
import type {
  BleHeartRate,
  BleHeartRateState,
  BleStateChangedEvent,
  ConnectedInterval,
} from '../../modules/swi-ble-heart-rate/src';
import type { NativeHttpResponse, WatchControl } from '../../modules/swi-watch-control';
import type { BandChoice } from './bluetooth/bluetoothBandChoice';
import type { HealthConnectState } from './healthConnect/healthConnectReader';
import type { ReadinessReport } from './readinessReport';
import { useReadinessReport } from './useReadinessReport';

// O relato de prontidão ligado às fontes do app: com o contexto do envio, a
// pulseira escolhida, a ponte do Bluetooth e o controle do aparelho dublados,
// afirma quando o relato sai (na montagem, na mudança de um fato, a cada
// sincronização), o que ele leva, que o iPhone nunca envia e que o 401 segue
// o caminho do pareamento revogado.

// --- Fronteiras dubladas -----------------------------------------------------

const HC: HealthConnectState = {
  availability: 'available',
  permission: 'granted',
  backgroundPermission: 'granted',
  bandPackage: 'com.xiaomi.wearable',
  bandLabel: 'Mi Fitness',
  noBand: false,
  lastSyncAt: '2026-10-22T10:00:00.000Z',
  lastFailureReason: null,
  lastFailureAt: null,
};

let mockPaired = true;
let mockHealthConnect: HealthConnectState | null = HC;
const mockRefreshPairing = jest.fn();
jest.mock('./TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({
    paired: mockPaired,
    healthConnect: mockHealthConnect,
    refreshPairing: mockRefreshPairing,
  }),
}));

let mockEscolha: BandChoice | null | undefined = { deviceId: 'AA:BB', name: 'Mi Band' };
// Sem o gate do Bluetooth o hook passa um armazenamento que nunca tem
// pulseira; o dublê respeita esse armazenamento.
jest.mock('./bluetooth/bluetoothBandChoice', () => ({
  sharedBandChoiceStore: () => ({}),
  useBandChoice: (store: { current?: () => unknown }) => (store.current ? store.current() : mockEscolha),
}));

jest.mock('../profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: { fullName: 'Trabalhador Teste', birthDate: '25/12/1990' } }),
}));
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'func-1' } }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock('../../lib/featureFlags', () => ({
  ...jest.requireActual('../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));
const mockGate = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

// A ponte do Bluetooth: o estado de agora, os trechos conectados e o evento
// de mudança, disparado pela suíte.
const LEITURA = Date.parse('2026-10-22T10:05:00.000Z');
function ponteFalsa(estado: BleHeartRateState = 'connected', trechos: ConnectedInterval[] = []) {
  let ouvinte: ((event: BleStateChangedEvent) => void) | null = null;
  const ble = {
    supported: true,
    status: jest.fn(() => ({ state: estado, deviceId: 'AA:BB', lastReadingAt: LEITURA })),
    connectedIntervals: jest.fn(() => trechos),
    onStateChanged: jest.fn((listener: (event: BleStateChangedEvent) => void) => {
      ouvinte = listener;
      return () => {
        ouvinte = null;
      };
    }),
  } as unknown as BleHeartRate;
  const mudar = (state: BleHeartRateState, changedAt: number) =>
    act(() => {
      ouvinte?.({ state, deviceId: 'AA:BB', changedAt });
    });
  return { ble, mudar };
}

type Resposta = NativeHttpResponse | Error;
function controleFalso(...respostas: Resposta[]) {
  const request = jest.fn(async (): Promise<NativeHttpResponse> => {
    const proxima = respostas.length > 1 ? respostas.shift()! : (respostas[0] ?? { status: 204, body: '' });
    if (proxima instanceof Error) throw proxima;
    return proxima;
  });
  const clearDeviceCredential = jest.fn();
  return { control: { request, clearDeviceCredential } as unknown as WatchControl, request, clearDeviceCredential };
}

const API = () => 'https://api.example.test';
const URL_RELATO = 'https://api.example.test/telemetry/v1/devices/me/readiness';

let deps: { control: WatchControl; ble: BleHeartRate; apiUrl: () => string };
function Raiz() {
  useReadinessReport(deps);
  return null;
}

let arvore: ReactTestRenderer | null = null;
const flush = () => act(async () => undefined);
async function montar() {
  act(() => {
    arvore = create(<Raiz />);
  });
  await flush();
}
async function rerender() {
  act(() => {
    arvore!.update(<Raiz />);
  });
  await flush();
}

const relatos = (request: jest.Mock) =>
  request.mock.calls.map((call: unknown[]) => JSON.parse(call[2] as string) as ReadinessReport);

beforeEach(() => {
  mockPaired = true;
  mockHealthConnect = HC;
  mockEscolha = { deviceId: 'AA:BB', name: 'Mi Band' };
  mockRefreshPairing.mockClear();
  mockGate.mockImplementation((gate) => gate === 'healthConnect' || gate === 'bluetoothHeartRate');
  naPlataforma('android');
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => {
    arvore?.unmount();
  });
  arvore = null;
  naPlataforma(originalOS);
  jest.restoreAllMocks();
});

describe('quando o relato sai', () => {
  it('ao montar, com a credencial do aparelho e o relato inteiro', async () => {
    const c = controleFalso();
    const desde = Date.parse('2026-10-22T09:00:00.000Z');
    deps = { control: c.control, ble: ponteFalsa('connected', [{ start: desde, end: null }]).ble, apiUrl: API };

    await montar();

    expect(c.request).toHaveBeenCalledTimes(1);
    expect(c.request).toHaveBeenCalledWith(URL_RELATO, 'PUT', expect.any(String), { kind: 'device' }, false);
    expect(relatos(c.request)[0]).toEqual<ReadinessReport>({
      healthConnect: {
        availability: 'AVAILABLE',
        readGranted: true,
        backgroundGranted: true,
        manufacturerPackage: 'com.xiaomi.wearable',
        lastSyncAt: '2026-10-22T10:00:00.000Z',
        lastFailure: null,
      },
      bluetooth: {
        bandChosen: true,
        listenerState: 'CONNECTED',
        listenerStateSince: '2026-10-22T09:00:00.000Z',
        lastReadingAt: '2026-10-22T10:05:00.000Z',
      },
    });
  });

  it('render sem fato novo não reenvia', async () => {
    const c = controleFalso();
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };
    await montar();

    mockHealthConnect = { ...HC };
    await rerender();

    expect(c.request).toHaveBeenCalledTimes(1);
  });

  it('quando um fato muda: leitura revogada', async () => {
    const c = controleFalso();
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };
    await montar();

    mockHealthConnect = { ...HC, permission: 'denied', backgroundPermission: 'denied' };
    await rerender();

    expect(c.request).toHaveBeenCalledTimes(2);
    expect(relatos(c.request)[1].healthConnect).toMatchObject({ readGranted: false, backgroundGranted: false });
  });

  it('a cada sincronização: a rodada nova move a última sincronização', async () => {
    const c = controleFalso();
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };
    await montar();

    mockHealthConnect = { ...HC, lastSyncAt: '2026-10-22T10:15:00.000Z' };
    await rerender();

    expect(relatos(c.request)[1].healthConnect.lastSyncAt).toBe('2026-10-22T10:15:00.000Z');
  });

  it('a sincronização que falhou leva o motivo e a hora', async () => {
    const c = controleFalso();
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };
    await montar();

    mockHealthConnect = { ...HC, lastFailureReason: 'permission_denied', lastFailureAt: '2026-10-22T10:15:00.000Z' };
    await rerender();

    expect(relatos(c.request)[1].healthConnect.lastFailure).toEqual({
      reason: 'PERMISSION_DENIED',
      at: '2026-10-22T10:15:00.000Z',
    });
  });

  it('quando a escuta muda de estado, com a hora da mudança', async () => {
    const c = controleFalso();
    const ponte = ponteFalsa('connected');
    deps = { control: c.control, ble: ponte.ble, apiUrl: API };
    await montar();

    ponte.mudar('searching', Date.parse('2026-10-22T10:20:00.000Z'));
    await flush();

    expect(relatos(c.request)[1].bluetooth).toMatchObject({
      listenerState: 'SEARCHING',
      listenerStateSince: '2026-10-22T10:20:00.000Z',
    });
  });

  it('a escuta parada sai como encerrada', async () => {
    const c = controleFalso();
    const ponte = ponteFalsa('connected');
    deps = { control: c.control, ble: ponte.ble, apiUrl: API };
    await montar();

    ponte.mudar('idle', Date.parse('2026-10-22T10:20:00.000Z'));
    await flush();

    expect(relatos(c.request)[1].bluetooth.listenerState).toBe('ENDED');
  });

  it('quando a pulseira é escolhida', async () => {
    const c = controleFalso();
    mockEscolha = null;
    deps = { control: c.control, ble: ponteFalsa('idle').ble, apiUrl: API };
    await montar();

    mockEscolha = { deviceId: 'AA:BB', name: 'Mi Band' };
    await rerender();

    expect(relatos(c.request).map((r) => r.bluetooth.bandChosen)).toEqual([false, true]);
  });

  it('a última leitura não é gatilho: vai junto, lida na hora do envio', async () => {
    const c = controleFalso();
    const ponte = ponteFalsa();
    deps = { control: c.control, ble: ponte.ble, apiUrl: API };
    await montar();

    (ponte.ble.status as jest.Mock).mockReturnValue({
      state: 'connected',
      deviceId: 'AA:BB',
      lastReadingAt: LEITURA + 1000,
    });
    await rerender();
    expect(c.request).toHaveBeenCalledTimes(1);

    mockHealthConnect = { ...HC, lastSyncAt: '2026-10-22T10:15:00.000Z' };
    await rerender();
    expect(relatos(c.request)[1].bluetooth.lastReadingAt).toBe('2026-10-22T10:05:01.000Z');
  });
});

describe('quando não sai', () => {
  it('nunca no iPhone', async () => {
    const c = controleFalso();
    naPlataforma('ios');
    mockGate.mockReturnValue(true);
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };

    await montar();
    mockHealthConnect = { ...HC, lastSyncAt: '2026-10-22T10:15:00.000Z' };
    await rerender();

    expect(c.request).not.toHaveBeenCalled();
  });

  it('sem o gate do Health Connect', async () => {
    const c = controleFalso();
    mockGate.mockReturnValue(false);
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };

    await montar();

    expect(c.request).not.toHaveBeenCalled();
  });

  it('sem pareamento; e sai assim que pareia', async () => {
    const c = controleFalso();
    mockPaired = false;
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };
    await montar();
    expect(c.request).not.toHaveBeenCalled();

    mockPaired = true;
    await rerender();
    expect(c.request).toHaveBeenCalledTimes(1);
  });

  it('antes de o leitor e a escolha da pulseira serem lidos: não afirma o que ninguém viu', async () => {
    const c = controleFalso();
    mockHealthConnect = null;
    mockEscolha = undefined;
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };
    await montar();

    mockHealthConnect = HC;
    await rerender();
    expect(c.request).not.toHaveBeenCalled();

    mockEscolha = null;
    await rerender();
    expect(c.request).toHaveBeenCalledTimes(1);
  });
});

describe('o que o relato não leva', () => {
  it('nada além do contrato: a resposta "Qual é o app da sua pulseira?" fica no aparelho', async () => {
    const c = controleFalso();
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };
    await montar();

    const [relato] = relatos(c.request);
    expect(Object.keys(relato).sort()).toEqual(['bluetooth', 'healthConnect']);
    expect(Object.keys(relato.healthConnect).sort()).toEqual([
      'availability',
      'backgroundGranted',
      'lastFailure',
      'lastSyncAt',
      'manufacturerPackage',
      'readGranted',
    ]);
    expect(Object.keys(relato.bluetooth).sort()).toEqual([
      'bandChosen',
      'lastReadingAt',
      'listenerState',
      'listenerStateSince',
    ]);
  });

  it('sem o gate do Bluetooth: sem pulseira, sem escuta, sem leitura', async () => {
    const c = controleFalso();
    mockGate.mockImplementation((gate) => gate === 'healthConnect');
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };
    await montar();

    expect(relatos(c.request)[0].bluetooth).toEqual({
      bandChosen: false,
      listenerState: null,
      listenerStateSince: null,
      lastReadingAt: null,
    });
  });
});

describe('falhas', () => {
  it('401: apaga a credencial e relê o pareamento, o caminho do aparelho revogado', async () => {
    const c = controleFalso({ status: 401, body: '' });
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };

    await montar();

    expect(c.clearDeviceCredential).toHaveBeenCalledTimes(1);
    expect(mockRefreshPairing).toHaveBeenCalledTimes(1);
  });

  it('falha de rede não derruba nada e o próximo gatilho tenta de novo', async () => {
    const c = controleFalso(Object.assign(new Error('rede'), { code: 'E_NETWORK' }), { status: 204, body: '' });
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };
    await montar();
    expect(c.request).toHaveBeenCalledTimes(1);
    expect(mockRefreshPairing).not.toHaveBeenCalled();

    mockHealthConnect = { ...HC, lastSyncAt: '2026-10-22T10:15:00.000Z' };
    await rerender();

    expect(c.request).toHaveBeenCalledTimes(2);
    expect(relatos(c.request)[1].healthConnect.lastSyncAt).toBe('2026-10-22T10:15:00.000Z');
  });

  it('mudanças durante um envio em curso: sai só o relato mais novo, depois dele', async () => {
    let liberar!: () => void;
    const c = controleFalso();
    c.request.mockImplementationOnce(
      () =>
        new Promise<NativeHttpResponse>((resolve) => {
          liberar = () => resolve({ status: 204, body: '' });
        }),
    );
    deps = { control: c.control, ble: ponteFalsa().ble, apiUrl: API };
    await montar();

    mockHealthConnect = { ...HC, lastSyncAt: '2026-10-22T10:15:00.000Z' };
    await rerender();
    mockHealthConnect = { ...HC, lastSyncAt: '2026-10-22T10:30:00.000Z' };
    await rerender();
    expect(c.request).toHaveBeenCalledTimes(1);

    await act(async () => {
      liberar();
    });
    await flush();

    expect(relatos(c.request).map((r) => r.healthConnect.lastSyncAt)).toEqual([
      '2026-10-22T10:00:00.000Z',
      '2026-10-22T10:30:00.000Z',
    ]);
  });
});
