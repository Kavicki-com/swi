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

let mockJourney: { state: string; loadStatus: string } = { state: 'ongoing', loadStatus: 'ready' };
jest.mock('../../../services/journey/JourneyProvider', () => ({
  JourneyProvider: ({ children }: { children: React.ReactNode }) => children,
  useJourney: () => mockJourney,
}));
const mockJourneyTracking = jest.fn();
jest.mock('../../../services/positions/useTrackingLifecycle', () => ({
  useJourneyTracking: (...args: unknown[]) => mockJourneyTracking(...args),
}));
jest.mock('../../../services/evacuation/EvacuationProvider', () => ({
  EvacuationProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../../services/notifications/NotificationProvider', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => children,
}));
const mockSendQueueRoot = jest.fn((_props: { userId: string }) => null);
jest.mock('../../../components/outbox/SendQueueRoot', () => ({
  SendQueueRoot: (props: { userId: string }) => mockSendQueueRoot(props),
}));
const mockStopLive = jest.fn();
jest.mock('../../../services/live/liveBroadcast', () => ({
  liveBroadcast: { stop: () => mockStopLive() },
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
    mockJourney = { state: 'paused', loadStatus: 'ready' };
    render();
    expect(mockJourneyTracking).toHaveBeenLastCalledWith('u1', 'paused', true);
  });

  it('jornada carregada sem tarefas também conta como conhecida', () => {
    mockJourney = { state: 'idle', loadStatus: 'empty' };
    render();
    expect(mockJourneyTracking).toHaveBeenLastCalledWith('u1', 'idle', true);
  });

  it('jornada ainda carregando, ou que falhou, não é conhecida', () => {
    for (const loadStatus of ['idle', 'loading', 'error']) {
      mockJourney = { state: 'idle', loadStatus };
      render();
      expect(mockJourneyTracking).toHaveBeenLastCalledWith('u1', 'idle', false);
    }
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
});
