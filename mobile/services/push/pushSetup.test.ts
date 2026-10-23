import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { EVACUATION_CHANNEL_ID, PUSH_TASK_NAME } from './evacuationPush';
import { ensureEvacuationChannel, resetEvacuationChannelForTest } from './evacuationChannel';
import { presentInForeground, setupPushNotifications } from './pushSetup';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  registerTaskAsync: jest.fn(async () => null),
  AndroidImportance: { HIGH: 4, MAX: 5 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

const mockStartEvacuation = jest.fn(async (_userId: string, _evacuationId: string) => 'tracking');
const mockEndEvacuation = jest.fn(async () => undefined);
const mockReadEvacuation = jest.fn(async () => null);
jest.mock('../positions/positionTracking', () => ({
  getPositionRuntime: () => ({
    evacuation: { read: () => mockReadEvacuation() },
    tracking: {
      startEvacuation: (userId: string, evacuationId: string) => mockStartEvacuation(userId, evacuationId),
      endEvacuation: () => mockEndEvacuation(),
    },
  }),
}));
const mockReadStoredSession = jest.fn();
jest.mock('../auth/storedSession', () => ({
  readStoredSession: () => mockReadStoredSession(),
}));

type Executor = (body: { data?: unknown; error?: unknown }) => Promise<void>;
const executor = (): Executor => (TaskManager.defineTask as jest.Mock).mock.calls[0][1];

const originalOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { value: os });
const estado = AppState as { currentState: unknown };
const estadoAntes = estado.currentState;

beforeEach(() => {
  setOS('android');
  estado.currentState = 'background';
  resetEvacuationChannelForTest();
  mockReadStoredSession.mockResolvedValue({
    user: { id: 'u1', email: 'ana@ex.com', name: 'Ana' },
    confirmedAt: '2026-10-23T10:00:00.000Z',
  });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  setOS(originalOS);
  estado.currentState = estadoAntes;
});

const notification = (content: { title?: string | null; body?: string | null }) =>
  ({ request: { identifier: 'n1', content: { data: {}, ...content } } }) as unknown as Notifications.Notification;

describe('canal da evacuação', () => {
  it('cria o canal com importância alta, som e visível na tela bloqueada', async () => {
    await ensureEvacuationChannel();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      EVACUATION_CHANNEL_ID,
      expect.objectContaining({
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
    );
  });

  it('cria uma vez só, mesmo pedido de vários lugares', async () => {
    await Promise.all([ensureEvacuationChannel(), ensureEvacuationChannel()]);
    await ensureEvacuationChannel();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(1);
  });

  it('falhou: a próxima chamada tenta de novo', async () => {
    (Notifications.setNotificationChannelAsync as jest.Mock).mockRejectedValueOnce(new Error('x'));
    await expect(ensureEvacuationChannel()).rejects.toThrow('x');
    await ensureEvacuationChannel();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(2);
  });

  it('fora do Android não há canal', async () => {
    setOS('ios');
    await ensureEvacuationChannel();
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });
});

describe('presentInForeground', () => {
  it('com o app aberto, a notificação com texto aparece e toca', async () => {
    await expect(presentInForeground(notification({ title: 'Evacuação iniciada' }))).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  // O fim da evacuação é só de dados: mostrar viraria uma notificação vazia.
  it('mensagem só de dados não aparece', async () => {
    await expect(presentInForeground(notification({ title: null, body: null }))).resolves.toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });
});

describe('setupPushNotifications', () => {
  it('liga o handler, cria o canal, define e registra a tarefa', async () => {
    setupPushNotifications();
    expect(Notifications.setNotificationHandler).toHaveBeenCalledWith({
      handleNotification: presentInForeground,
    });
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(1);
    expect(TaskManager.defineTask).toHaveBeenCalledWith(PUSH_TASK_NAME, expect.any(Function));
    expect(Notifications.registerTaskAsync).toHaveBeenCalledWith(PUSH_TASK_NAME);
  });

  it('a tarefa liga o rastreio da pessoa da sessão salva no início', async () => {
    setupPushNotifications();
    await executor()({
      data: { data: { dataString: '{"type":"evacuation.started","evacuationId":"e5"}' } },
    });
    expect(mockStartEvacuation).toHaveBeenCalledWith('u1', 'e5');
  });

  it('a tarefa desliga no fim', async () => {
    setupPushNotifications();
    await executor()({
      data: { data: { dataString: '{"type":"evacuation.ended","evacuationId":"e5"}' } },
    });
    expect(mockEndEvacuation).toHaveBeenCalledTimes(1);
  });

  it('sem sessão salva, a tarefa não liga nada', async () => {
    mockReadStoredSession.mockResolvedValueOnce(null);
    setupPushNotifications();
    await executor()({
      data: { data: { dataString: '{"type":"evacuation.started","evacuationId":"e5"}' } },
    });
    expect(mockStartEvacuation).not.toHaveBeenCalled();
  });

  it('com o app na frente, a tarefa deixa para a tela', async () => {
    estado.currentState = 'active';
    setupPushNotifications();
    await executor()({
      data: { data: { dataString: '{"type":"evacuation.started","evacuationId":"e5"}' } },
    });
    expect(mockStartEvacuation).not.toHaveBeenCalled();
  });

  it('erro do sistema não chama o tratamento', async () => {
    setupPushNotifications();
    await executor()({ error: new Error('x'), data: { data: { dataString: '{}' } } });
    expect(mockReadStoredSession).not.toHaveBeenCalled();
  });

  it('falha no tratamento é engolida com aviso, sem derrubar a tarefa', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockReadEvacuation.mockRejectedValueOnce(new Error('disco'));
    mockEndEvacuation.mockRejectedValueOnce(new Error('disco'));
    setupPushNotifications();
    await expect(
      executor()({ data: { data: { dataString: '{"type":"evacuation.ended","evacuationId":"e5"}' } } }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('falha ao registrar a tarefa ou criar o canal só avisa', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (Notifications.registerTaskAsync as jest.Mock).mockRejectedValueOnce(new Error('módulo'));
    (Notifications.setNotificationChannelAsync as jest.Mock).mockRejectedValueOnce(new Error('canal'));
    expect(() => setupPushNotifications()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('na web não faz nada', () => {
    setOS('web');
    setupPushNotifications();
    expect(Notifications.setNotificationHandler).not.toHaveBeenCalled();
    expect(TaskManager.defineTask).not.toHaveBeenCalled();
  });
});
