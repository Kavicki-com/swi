import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as Notifications from 'expo-notifications';
import { EVACUATION_ROUTE, usePushNotifications } from './usePushNotifications';

type Listener<T> = (event: T) => void;
let mockTokenListener: Listener<unknown> | null = null;
let mockReceived: Listener<unknown> | null = null;
let mockResponse: Listener<unknown> | null = null;
const mockRemoved = jest.fn();
jest.mock('expo-notifications', () => ({
  addPushTokenListener: jest.fn((listener: Listener<unknown>) => {
    mockTokenListener = listener;
    return { remove: () => mockRemoved('token') };
  }),
  addNotificationReceivedListener: jest.fn((listener: Listener<unknown>) => {
    mockReceived = listener;
    return { remove: () => mockRemoved('received') };
  }),
  addNotificationResponseReceivedListener: jest.fn((listener: Listener<unknown>) => {
    mockResponse = listener;
    return { remove: () => mockRemoved('response') };
  }),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
}));

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockRouterPush }) }));

const mockRegister = jest.fn(async () => 'registered');
const mockRefresh = jest.fn(async (_token: unknown) => undefined);
jest.mock('./pushRegistration', () => ({
  getPushRegistration: () => ({ register: mockRegister, refresh: mockRefresh }),
}));

const mockReportEnded = jest.fn();
jest.mock('../evacuation/evacuationEnd', () => ({
  reportEvacuationEnded: (id: string) => mockReportEnded(id),
}));

const mockAnnounce = jest.fn();
jest.mock('./evacuationPush', () => ({
  ...jest.requireActual('./evacuationPush'),
  announceEvacuationPush: (id: string) => mockAnnounce(id),
}));

function Probe({ userId }: { userId: string | null }) {
  usePushNotifications(userId);
  return null;
}

const notification = (identifier: string, data: unknown) => ({
  request: { identifier, content: { title: 'Evacuação iniciada', body: 'x', data } },
});
const response = (identifier: string, data: unknown) => ({
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: notification(identifier, data),
});
const startedData = { type: 'evacuation.started', evacuationId: 'e1' };

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

let tree: ReactTestRenderer | null = null;
async function mount(userId: string | null) {
  await act(async () => {
    tree = create(<Probe userId={userId} />);
  });
  await flush();
}

const originalOS = Platform.OS;
afterEach(() => {
  act(() => tree?.unmount());
  tree = null;
  jest.clearAllMocks();
  mockTokenListener = null;
  mockReceived = null;
  mockResponse = null;
  Object.defineProperty(Platform, 'OS', { value: originalOS });
});

describe('usePushNotifications', () => {
  it('com a pessoa logada, registra o aparelho', async () => {
    await mount('u1');
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('o sistema troca o token: manda o novo', async () => {
    await mount('u1');
    mockTokenListener!({ type: 'android', data: 'fcm-novo' });
    expect(mockRefresh).toHaveBeenCalledWith({ type: 'android', data: 'fcm-novo' });
  });

  it('sem sessão, não registra nem escuta', async () => {
    await mount(null);
    expect(mockRegister).not.toHaveBeenCalled();
    expect(Notifications.addNotificationReceivedListener).not.toHaveBeenCalled();
  });

  it('na web, nada', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });
    await mount('u1');
    expect(mockRegister).not.toHaveBeenCalled();
    expect(Notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
  });

  // App aberto: a notificação aparece pelo handler e a consulta da evacuação
  // dispara na hora, pelo mesmo aviso que o socket usa.
  it('push da evacuação com o app aberto avisa o rastreio', async () => {
    await mount('u1');
    mockReceived!(notification('n1', startedData));
    expect(mockAnnounce).toHaveBeenCalledWith('n1');
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // O fim pelo push com o app aberto alimenta o aviso de fim único: as telas
  // saem do modo evacuação e o rastreio encerra, como pelo socket.
  it('fim pelo push com o app aberto avisa o fim da evacuação', async () => {
    await mount('u1');
    mockReceived!(notification('n8', { type: 'evacuation.ended', evacuationId: 'e1' }));
    expect(mockReportEnded).toHaveBeenCalledWith('e1');
    expect(mockAnnounce).toHaveBeenCalledWith('n8');
  });

  it('o início pelo push não é aviso de fim', async () => {
    await mount('u1');
    mockReceived!(notification('n9', startedData));
    expect(mockReportEnded).not.toHaveBeenCalled();
  });

  it('push que não é da evacuação não avisa', async () => {
    await mount('u1');
    mockReceived!(notification('n2', { type: 'chat' }));
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it('toque no início abre a tela de evacuação e consulta', async () => {
    await mount('u1');
    mockResponse!(response('n3', startedData));
    expect(mockRouterPush).toHaveBeenCalledWith(EVACUATION_ROUTE);
    expect(mockAnnounce).toHaveBeenCalledWith('n3');
    expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
  });

  it('o mesmo toque não abre a tela duas vezes', async () => {
    await mount('u1');
    mockResponse!(response('n4', startedData));
    mockResponse!(response('n4', startedData));
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
  });

  // App aberto pelo toque com ele fechado: a resposta já estava lá antes de
  // a escuta começar.
  it('abertura pelo toque: a resposta guardada também abre a tela', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValueOnce(
      response('n5', startedData),
    );
    await mount('u1');
    expect(mockRouterPush).toHaveBeenCalledWith(EVACUATION_ROUTE);
  });

  it('toque numa notificação que não é da evacuação não navega', async () => {
    await mount('u1');
    mockResponse!(response('n6', { type: 'chat' }));
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('navegação que falha não derruba o app', async () => {
    mockRouterPush.mockImplementationOnce(() => {
      throw new Error('navegação ainda não montada');
    });
    await mount('u1');
    expect(() => mockResponse!(response('n7', startedData))).not.toThrow();
    expect(mockAnnounce).toHaveBeenCalledWith('n7');
  });

  it('falha ao ler a resposta guardada é ignorada', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockRejectedValueOnce(new Error('x'));
    await mount('u1');
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('ao sair da sessão, para de escutar', async () => {
    await mount('u1');
    act(() => tree!.unmount());
    tree = null;
    expect(mockRemoved).toHaveBeenCalledWith('token');
    expect(mockRemoved).toHaveBeenCalledWith('received');
    expect(mockRemoved).toHaveBeenCalledWith('response');
  });
});
