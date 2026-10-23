import * as Notifications from 'expo-notifications';
import {
  createPushRegistration,
  getPushRegistration,
  PUSH_UNREGISTER_DEADLINE_MS,
  unregisterPush,
  type PushPermission,
  type PushRegistrationDeps,
} from './pushRegistration';

jest.mock('expo-notifications', () => ({
  PermissionStatus: { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'projeto-eas' } } } },
}));
jest.mock('../../lib/featureFlags', () => ({ AUTH_BACKEND: 'api' }));
const mockEnsureChannel = jest.fn(async () => undefined);
jest.mock('./evacuationChannel', () => ({ ensureEvacuationChannel: () => mockEnsureChannel() }));
const mockSend = jest.fn(async (_token: string, _platform: string) => undefined);
const mockRemove = jest.fn(async (_token: string) => undefined);
jest.mock('./pushTokens', () => ({
  sendPushToken: (token: string, platform: string) => mockSend(token, platform),
  deletePushToken: (token: string) => mockRemove(token),
}));

const TOKEN = 'ExponentPushToken[abc123]';

function setup(overrides: Partial<PushRegistrationDeps> = {}) {
  const deps: PushRegistrationDeps = {
    platform: 'android',
    ensureChannel: jest.fn(async () => undefined),
    permission: jest.fn(async (): Promise<PushPermission> => 'granted'),
    requestPermission: jest.fn(async () => true),
    getToken: jest.fn(async () => TOKEN),
    send: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    ...overrides,
  };
  return { deps, registration: createPushRegistration(deps) };
}

describe('register', () => {
  it('com a permissão dada, manda o token com a plataforma', async () => {
    const { deps, registration } = setup();
    await expect(registration.register()).resolves.toBe('registered');
    expect(deps.send).toHaveBeenCalledWith(TOKEN, 'android');
    expect(deps.requestPermission).not.toHaveBeenCalled();
  });

  // No Android 13 ou mais novo o pedido só aparece depois de existir um canal,
  // e o token também pede o canal antes.
  it('cria o canal antes de olhar a permissão', async () => {
    const order: string[] = [];
    const { registration } = setup({
      ensureChannel: jest.fn(async () => {
        order.push('canal');
      }),
      permission: jest.fn(async (): Promise<PushPermission> => {
        order.push('permissão');
        return 'granted';
      }),
    });
    await registration.register();
    expect(order).toEqual(['canal', 'permissão']);
  });

  it('falha ao criar o canal não impede o registro', async () => {
    const { deps, registration } = setup({
      ensureChannel: jest.fn(async () => {
        throw new Error('canal');
      }),
    });
    await expect(registration.register()).resolves.toBe('registered');
    expect(deps.send).toHaveBeenCalled();
  });

  it('nunca perguntado: pede uma vez e, aceito, registra', async () => {
    const { deps, registration } = setup({
      permission: jest.fn(async (): Promise<PushPermission> => 'undetermined'),
    });
    await expect(registration.register()).resolves.toBe('registered');
    expect(deps.requestPermission).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalled();
  });

  it('pedido recusado: nada é mandado e nada quebra', async () => {
    const { deps, registration } = setup({
      permission: jest.fn(async (): Promise<PushPermission> => 'undetermined'),
      requestPermission: jest.fn(async () => false),
    });
    await expect(registration.register()).resolves.toBe('denied');
    expect(deps.getToken).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  // Negada antes, não pergunta de novo a cada abertura: liberar fica nos ajustes.
  it('já negada: não pergunta de novo', async () => {
    const { deps, registration } = setup({
      permission: jest.fn(async (): Promise<PushPermission> => 'denied'),
    });
    await expect(registration.register()).resolves.toBe('denied');
    expect(deps.requestPermission).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('erro ao pedir ou ler a permissão vale como negada', async () => {
    const pedir = setup({
      permission: jest.fn(async (): Promise<PushPermission> => 'undetermined'),
      requestPermission: jest.fn(async () => {
        throw new Error('activity');
      }),
    });
    await expect(pedir.registration.register()).resolves.toBe('denied');
    const ler = setup({
      permission: jest.fn(async (): Promise<PushPermission> => {
        throw new Error('módulo');
      }),
    });
    await expect(ler.registration.register()).resolves.toBe('denied');
  });

  // Sem o Firebase na build ou sem rede para a Expo, o token não vem.
  it('token que não vem: falha sem lançar', async () => {
    const { deps, registration } = setup({
      getToken: jest.fn(async () => {
        throw new Error('FirebaseApp não inicializado');
      }),
    });
    await expect(registration.register()).resolves.toBe('failed');
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('API fora do ar: falha sem lançar', async () => {
    const { registration } = setup({
      send: jest.fn(async () => {
        throw new Error('rede');
      }),
    });
    await expect(registration.register()).resolves.toBe('failed');
  });

  it('sem plataforma de push (web ou login de demonstração), nada acontece', async () => {
    const { deps, registration } = setup({ platform: null });
    await expect(registration.register()).resolves.toBe('unavailable');
    expect(deps.ensureChannel).not.toHaveBeenCalled();
    expect(deps.permission).not.toHaveBeenCalled();
  });
});

describe('refresh', () => {
  it('token novo do sistema: manda de novo, sem perguntar nada', async () => {
    const { deps, registration } = setup({
      getToken: jest.fn(async () => 'ExponentPushToken[novo]'),
    });
    await registration.refresh({ type: 'android', data: 'fcm-novo' });
    expect(deps.getToken).toHaveBeenCalledWith({ type: 'android', data: 'fcm-novo' });
    expect(deps.send).toHaveBeenCalledWith('ExponentPushToken[novo]', 'android');
    expect(deps.requestPermission).not.toHaveBeenCalled();
  });

  it('sem a permissão, a troca não manda nada', async () => {
    const { deps, registration } = setup({
      permission: jest.fn(async (): Promise<PushPermission> => 'denied'),
    });
    await registration.refresh(undefined);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('falha na troca não lança', async () => {
    const { registration } = setup({
      send: jest.fn(async () => {
        throw new Error('rede');
      }),
    });
    await expect(registration.refresh(undefined)).resolves.toBeUndefined();
  });

  it('sem plataforma de push, nada', async () => {
    const { deps, registration } = setup({ platform: null });
    await registration.refresh(undefined);
    expect(deps.getToken).not.toHaveBeenCalled();
  });
});

describe('unregister', () => {
  it('remove o token que foi registrado', async () => {
    const { deps, registration } = setup();
    await registration.register();
    (deps.getToken as jest.Mock).mockClear();
    await registration.unregister();
    expect(deps.remove).toHaveBeenCalledWith(TOKEN);
    expect(deps.getToken).not.toHaveBeenCalled();
  });

  // O registro desta abertura pode não ter terminado (ou ter falhado na API):
  // com a permissão dada, o token do aparelho é pedido de novo para remover.
  it('sem token conhecido e com permissão, pede o token e remove', async () => {
    const { deps, registration } = setup();
    await registration.unregister();
    expect(deps.remove).toHaveBeenCalledWith(TOKEN);
  });

  it('sem token conhecido e sem permissão, não há o que remover', async () => {
    const { deps, registration } = setup({
      permission: jest.fn(async (): Promise<PushPermission> => 'denied'),
    });
    await registration.unregister();
    expect(deps.getToken).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it('falha ao remover não lança: o logout segue', async () => {
    const { registration } = setup({
      remove: jest.fn(async () => {
        throw new Error('rede');
      }),
    });
    await registration.register();
    await expect(registration.unregister()).resolves.toBeUndefined();
  });

  it('falha ao pedir o token para remover também não lança', async () => {
    const { deps, registration } = setup({
      getToken: jest.fn(async () => {
        throw new Error('rede');
      }),
    });
    await expect(registration.unregister()).resolves.toBeUndefined();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it('depois de remover, o token é esquecido', async () => {
    const { deps, registration } = setup({
      permission: jest.fn(async (): Promise<PushPermission> => 'granted'),
    });
    await registration.register();
    await registration.unregister();
    (deps.permission as jest.Mock).mockResolvedValue('denied');
    (deps.remove as jest.Mock).mockClear();
    await registration.unregister();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  // Sem rede, nem a Expo nem a API respondem: o logout não espera mais que o
  // prazo para apagar o JWT.
  it('tem prazo: chamada que não volta é abandonada', async () => {
    jest.useFakeTimers();
    try {
      const { registration } = setup({ remove: jest.fn(() => new Promise<void>(() => undefined)) });
      await registration.register();
      const done = jest.fn();
      const saida = registration.unregister().then(done);
      await jest.advanceTimersByTimeAsync(PUSH_UNREGISTER_DEADLINE_MS + 1);
      await saida;
      expect(done).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('sem plataforma de push, nada', async () => {
    const { deps, registration } = setup({ platform: null });
    await registration.unregister();
    expect(deps.permission).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });
});

// A ligação com o expo-notifications e a API. O registro real é um só por
// processo: os casos abaixo seguem em ordem sobre a mesma instância.
describe('getPushRegistration', () => {
  const permissions = Notifications.getPermissionsAsync as jest.Mock;
  const request = Notifications.requestPermissionsAsync as jest.Mock;
  const expoToken = Notifications.getExpoPushTokenAsync as jest.Mock;

  beforeEach(() => {
    permissions.mockReset();
    request.mockReset();
    expoToken.mockReset();
    mockSend.mockClear();
    mockRemove.mockClear();
  });

  it('nunca perguntado: pede, obtém o token com o projectId do EAS e manda', async () => {
    permissions.mockResolvedValue({ granted: false, status: 'undetermined' });
    request.mockResolvedValue({ granted: true, status: 'granted' });
    expoToken.mockResolvedValue({ type: 'expo', data: TOKEN });
    await expect(getPushRegistration().register()).resolves.toBe('registered');
    expect(mockEnsureChannel).toHaveBeenCalled();
    expect(expoToken).toHaveBeenCalledWith({ projectId: 'projeto-eas' });
    expect(mockSend).toHaveBeenCalledWith(TOKEN, expect.stringMatching(/^(android|ios)$/));
  });

  it('negada no sistema não pergunta de novo', async () => {
    permissions.mockResolvedValue({ granted: false, status: 'denied' });
    await expect(getPushRegistration().register()).resolves.toBe('denied');
    expect(request).not.toHaveBeenCalled();
  });

  it('a troca de token manda o token novo do sistema junto', async () => {
    permissions.mockResolvedValue({ granted: true, status: 'granted' });
    expoToken.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[novo]' });
    const device = { type: 'android', data: 'fcm' };
    await getPushRegistration().refresh(device);
    expect(expoToken).toHaveBeenCalledWith({ projectId: 'projeto-eas', devicePushToken: device });
    expect(mockSend).toHaveBeenCalledWith('ExponentPushToken[novo]', expect.any(String));
  });

  it('o logout remove o último token', async () => {
    await unregisterPush();
    expect(mockRemove).toHaveBeenCalledWith('ExponentPushToken[novo]');
  });
});
