import { Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { Redirect, Stack } from 'expo-router';
import AppLayout from '../../../app/(app)/_layout';

jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
  Stack: jest.fn(() => null),
}));

const mockUseAuth = jest.fn();
jest.mock('../../../services/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

let mockJourney: { state: string; loadStatus: string; source?: string | null } = {
  state: 'ongoing',
  loadStatus: 'ready',
};
const mockJourneyProvider = jest.fn();
jest.mock('../../../services/journey/JourneyProvider', () => ({
  JourneyProvider: ({ children, userId }: { children: React.ReactNode; userId?: string }) => {
    mockJourneyProvider({ userId });
    return children;
  },
  useJourney: () => mockJourney,
}));
const mockJourneyTracking = jest.fn();
jest.mock('../../../services/positions/useTrackingLifecycle', () => ({
  useJourneyTracking: (...args: unknown[]) => mockJourneyTracking(...args),
}));
jest.mock('../../../services/evacuation/EvacuationProvider', () => ({
  EvacuationProvider: ({ children }: { children: React.ReactNode }) => children,
}));
let mockNotifications: { id: string; domain: string; createdAt: string }[] = [];
jest.mock('../../../services/notifications/NotificationProvider', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => children,
  useNotifications: () => ({ notifications: mockNotifications }),
}));
const mockEvacuationTracking = jest.fn();
jest.mock('../../../services/positions/useEvacuationTracking', () => ({
  ...jest.requireActual('../../../services/positions/useEvacuationTracking'),
  useEvacuationTracking: (...args: unknown[]) => mockEvacuationTracking(...args),
}));
const mockHelpRequestProvider = jest.fn();
jest.mock('../../../services/help/HelpRequestProvider', () => ({
  HelpRequestProvider: ({ children }: { children: React.ReactNode }) => {
    mockHelpRequestProvider();
    return children;
  },
}));
const mockSendQueueRoot = jest.fn((_props: { userId: string }) => null);
jest.mock('../../../components/outbox/SendQueueRoot', () => ({
  SendQueueRoot: (props: { userId: string }) => mockSendQueueRoot(props),
}));
const mockLiveSelfView = jest.fn(() => null);
jest.mock('../../../components/LiveSelfView', () => ({
  LiveSelfView: () => mockLiveSelfView(),
}));
const mockStopLive = jest.fn();
jest.mock('../../../services/live/liveBroadcast', () => ({
  liveBroadcast: { stop: () => mockStopLive() },
}));

let mockGateBluetooth = false;
let mockGateHealthConnect = false;
jest.mock('../../../lib/featureFlags', () => ({
  isFeatureEnabled: (gate: string) =>
    (gate === 'bluetoothHeartRate' && mockGateBluetooth) ||
    (gate === 'healthConnect' && mockGateHealthConnect),
}));
let mockPaired = true;
jest.mock('../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({ paired: mockPaired }),
}));
let mockChoice: { deviceId: string; name: string | null } | null | undefined = undefined;
jest.mock('../../../services/telemetry/bluetooth/bluetoothBandChoice', () => ({
  useBandChoice: () => mockChoice,
}));
const mockBluetooth = jest.fn();
jest.mock('../../../services/telemetry/bluetooth/useBluetoothHeartRate', () => ({
  useBluetoothHeartRate: (...args: unknown[]) => mockBluetooth(...args),
}));
const mockPushNotifications = jest.fn();
jest.mock('../../../services/push/usePushNotifications', () => ({
  usePushNotifications: (...args: unknown[]) => mockPushNotifications(...args),
}));
let mockPushNotice: string | null = null;
jest.mock('../../../services/push/evacuationPush', () => ({
  ...jest.requireActual('../../../services/push/evacuationPush'),
  useEvacuationPushNotice: () => mockPushNotice,
}));
const mockReadinessReport = jest.fn();
jest.mock('../../../services/telemetry/useReadinessReport', () => ({
  useReadinessReport: () => mockReadinessReport(),
}));

const render = () => {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<AppLayout />);
  });
  return tree;
};

const achados = (tree: ReturnType<typeof create>, C: unknown) =>
  tree.root.findAllByType(C as React.ComponentType);

describe('(app)/_layout — auth gate com sessão persistida', () => {
  it('não derruba deep-link pro login enquanto a sessão restaura', () => {
    mockUseAuth.mockReturnValue({ user: null, restoring: true });
    const tree = render();
    expect(achados(tree, Redirect)).toHaveLength(0);
    expect(achados(tree, Stack)).toHaveLength(0);
  });

  it('sem sessão redireciona pro login', () => {
    mockUseAuth.mockReturnValue({ user: null, restoring: false });
    const tree = render();
    expect(achados(tree, Redirect)[0].props.href).toBe('/(auth)/login');
  });

  it('com sessão renderiza o Stack autenticado', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    const tree = render();
    expect(achados(tree, Stack)).toHaveLength(1);
    expect(achados(tree, Redirect)).toHaveLength(0);
  });
});

// O pedido de ajuda é um só para a sessão: o dashboard pede e o procedimento
// (do dashboard ou das notificações) mostra o estado. Sem sessão, nada é lido.
describe('(app)/_layout: pedido de ajuda', () => {
  beforeEach(() => mockHelpRequestProvider.mockClear());

  it('com sessão, o pedido de ajuda acompanha a área autenticada', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    render();
    expect(mockHelpRequestProvider).toHaveBeenCalled();
  });

  it('sem sessão, nada do pedido é montado', () => {
    mockUseAuth.mockReturnValue({ user: null, restoring: false });
    render();
    expect(mockHelpRequestProvider).not.toHaveBeenCalled();
  });
});

// A fila de envios (chat, relatório, comentário) vive na raiz da área
// autenticada: o envio segue com qualquer tela aberta e para ao sair.
describe('(app)/_layout: fila de envios', () => {
  beforeEach(() => mockSendQueueRoot.mockClear());

  it('com sessão, a fila é montada para a pessoa logada', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    render();
    expect(mockSendQueueRoot).toHaveBeenCalledWith({ userId: 'u1' });
  });

  it('sem sessão, a fila não é montada', () => {
    mockUseAuth.mockReturnValue({ user: null, restoring: false });
    render();
    expect(mockSendQueueRoot).not.toHaveBeenCalled();
  });
});

describe('(app)/_layout: rastreio em segundo plano', () => {
  beforeEach(() => {
    mockJourneyTracking.mockClear();
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
  });

  it('a jornada carregada decide o rastreio da pessoa logada', () => {
    mockJourney = { state: 'paused', loadStatus: 'ready', source: 'server' };
    render();
    expect(mockJourneyTracking).toHaveBeenLastCalledWith('u1', 'paused', true, undefined, 'server');
  });

  it('jornada carregada sem tarefas também conta como conhecida', () => {
    mockJourney = { state: 'idle', loadStatus: 'empty', source: 'server' };
    render();
    expect(mockJourneyTracking).toHaveBeenLastCalledWith('u1', 'idle', true, undefined, 'server');
  });

  it('jornada ainda carregando, ou que falhou, não é conhecida', () => {
    for (const loadStatus of ['idle', 'loading', 'error']) {
      mockJourney = { state: 'idle', loadStatus, source: null };
      render();
      expect(mockJourneyTracking).toHaveBeenLastCalledWith('u1', 'idle', false, undefined, 'server');
    }
  });

  // Abrir sem sinal: a jornada vem da cópia, e o rastreio sabe disso para só
  // retomar a janela que já estava aberta.
  it('jornada vinda da cópia leva a origem ao rastreio', () => {
    mockJourney = { state: 'ongoing', loadStatus: 'ready', source: 'cache' };
    render();
    expect(mockJourneyTracking).toHaveBeenLastCalledWith('u1', 'ongoing', true, undefined, 'cache');
  });

  it('a jornada recebe a pessoa logada como dona da cópia', () => {
    mockJourneyProvider.mockClear();
    render();
    expect(mockJourneyProvider).toHaveBeenCalledWith({ userId: 'u1' });
  });
});

// Evacuação ativa liga o rastreio mesmo sem jornada. A notificação de
// evacuação que chega é a deixa para consultar na hora.
describe('(app)/_layout: rastreio na evacuação', () => {
  beforeEach(() => {
    mockEvacuationTracking.mockClear();
    mockNotifications = [];
  });

  it('com sessão, segue a evacuação da pessoa logada', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    render();
    expect(mockEvacuationTracking).toHaveBeenLastCalledWith('u1', null);
  });

  it('recebe a notificação de evacuação mais recente', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    mockNotifications = [
      { id: 'n3', domain: 'chat', createdAt: '2026-10-04T12:00:00.000Z' },
      { id: 'n2', domain: 'evacuation', createdAt: '2026-10-04T11:00:00.000Z' },
      { id: 'n1', domain: 'evacuation', createdAt: '2026-10-04T10:00:00.000Z' },
    ];
    render();
    expect(mockEvacuationTracking).toHaveBeenLastCalledWith('u1', 'n2');
  });

  it('sem sessão, nada é montado', () => {
    mockUseAuth.mockReturnValue({ user: null, restoring: false });
    render();
    expect(mockEvacuationTracking).not.toHaveBeenCalled();
  });

  // O push da evacuação com o app aberto é a mesma deixa que o socket.
  it('o push da evacuação também muda o aviso', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    mockNotifications = [{ id: 'n2', domain: 'evacuation', createdAt: '2026-10-04T11:00:00.000Z' }];
    mockPushNotice = 'p1#1';
    render();
    expect(mockEvacuationTracking).toHaveBeenLastCalledWith('u1', 'n2|push:p1#1');
    mockPushNotice = null;
  });
});

// Push: o aparelho registra o token com a pessoa logada, e o toque na
// notificação do início abre a evacuação.
describe('(app)/_layout: push', () => {
  beforeEach(() => mockPushNotifications.mockClear());

  it('com sessão, o push acompanha a pessoa logada', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    render();
    expect(mockPushNotifications).toHaveBeenLastCalledWith('u1');
  });

  it('sem sessão, o push não é montado', () => {
    mockUseAuth.mockReturnValue({ user: null, restoring: false });
    render();
    expect(mockPushNotifications).not.toHaveBeenCalled();
  });
});

// A câmera ao vivo segue em qualquer tela da área autenticada e acaba junto
// com a sessão.
describe('(app)/_layout: câmera ao vivo', () => {
  beforeEach(() => mockStopLive.mockClear());

  it('a transmissão segue com a sessão e acaba ao sair da conta', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    const tree = render();
    expect(mockStopLive).not.toHaveBeenCalled();
    mockUseAuth.mockReturnValue({ user: null, restoring: false });
    act(() => tree.update(<AppLayout />));
    expect(mockStopLive).toHaveBeenCalledTimes(1);
  });

  it('o self-view da câmera é montado na área autenticada', () => {
    mockLiveSelfView.mockClear();
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    render();
    expect(mockLiveSelfView).toHaveBeenCalled();
  });
});

// Batimento pela pulseira no Bluetooth: a escuta segue a pulseira escolhida e
// o pareamento, nunca a jornada, e só existe com o gate.
describe('(app)/_layout: pulseira no Bluetooth', () => {
  beforeEach(() => {
    mockBluetooth.mockClear();
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
    mockJourney = { state: 'ongoing', loadStatus: 'ready', source: 'server' };
    mockPaired = true;
    mockChoice = { deviceId: 'A0:00', name: 'Polar H10' };
  });
  afterAll(() => {
    mockGateBluetooth = false;
  });

  it('sem o gate, a escuta nem é montada', () => {
    mockGateBluetooth = false;
    render();
    expect(mockBluetooth).not.toHaveBeenCalled();
  });

  it('com o gate, recebe o pareamento e a pulseira escolhida', () => {
    mockGateBluetooth = true;
    render();
    expect(mockBluetooth).toHaveBeenLastCalledWith({ userId: 'u1', paired: true, deviceId: 'A0:00' });
  });

  it('iniciar, pausar ou encerrar a jornada não muda nada para a escuta', () => {
    mockGateBluetooth = true;
    const vistos = (
      [
        { state: 'idle', loadStatus: 'ready', source: 'server' },
        { state: 'ongoing', loadStatus: 'ready', source: 'server' },
        { state: 'paused', loadStatus: 'ready', source: 'cache' },
        { state: 'idle', loadStatus: 'loading', source: null },
      ] as const
    ).map((journey) => {
      mockJourney = { ...journey };
      render();
      return mockBluetooth.mock.lastCall?.[0];
    });
    for (const visto of vistos) {
      expect(visto).toEqual({ userId: 'u1', paired: true, deviceId: 'A0:00' });
    }
  });

  it('escolha ainda não lida segue desconhecida; nenhuma escolha vira null', () => {
    mockGateBluetooth = true;
    mockChoice = undefined;
    render();
    expect(mockBluetooth.mock.lastCall?.[0]).toMatchObject({ deviceId: undefined });
    mockChoice = null;
    mockPaired = false;
    render();
    expect(mockBluetooth.mock.lastCall?.[0]).toEqual({ userId: 'u1', deviceId: null, paired: false });
  });
});

describe('(app)/_layout: relato de prontidão', () => {
  const originalOS = Platform.OS;
  const naPlataforma = (os: typeof Platform.OS) =>
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

  beforeEach(() => {
    mockReadinessReport.mockClear();
    mockUseAuth.mockReturnValue({ user: { id: 'u1' }, restoring: false });
  });
  afterEach(() => {
    naPlataforma(originalOS);
    mockGateHealthConnect = false;
  });

  it('no Android com o gate do Health Connect, o relato acompanha a sessão', () => {
    naPlataforma('android');
    mockGateHealthConnect = true;
    render();
    expect(mockReadinessReport).toHaveBeenCalled();
  });

  it('no iPhone, ou sem o gate, nem é montado', () => {
    naPlataforma('ios');
    mockGateHealthConnect = true;
    render();
    naPlataforma('android');
    mockGateHealthConnect = false;
    render();
    expect(mockReadinessReport).not.toHaveBeenCalled();
  });
});
