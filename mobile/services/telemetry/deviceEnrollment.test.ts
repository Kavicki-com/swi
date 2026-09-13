import * as SecureStore from 'expo-secure-store';
import { getApiUrl } from '../auth/apiConfig';
import {
  createWatchControl,
  type NativeHttpResponse,
  type WatchControl,
} from '../../modules/swi-watch-control';
import { completeEnrollment, type EnrollmentFailure } from './deviceEnrollment';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

const API = 'https://api.exemplo';
const TOKEN = 'token-do-funcionario';
const ENROLLMENT_ID = 'enr-123';
const CODE = '482910';

// O segredo existe só aqui, no dublê do Swift, como no aparelho existe só no
// chaveiro. Nada que a função devolva pode conter esta string.
const SEGREDO = 'dev-1.0123456789abcdef0123456789abcdef';

// Corpo de erro do Nest: { statusCode, message, error }.
const nestError = (statusCode: number, message: string | string[]) =>
  JSON.stringify({ statusCode, message, error: 'x' });

function fakeControl(overrides: Partial<WatchControl> = {}) {
  // Modela o Swift com storeCredential: guarda o segredo e sobe `true`.
  let guardado: string | null = null;
  const request = jest.fn(
    async (
      _url: string,
      _method: string,
      _body: string | null,
      _auth: unknown,
      storeCredential: boolean,
    ): Promise<NativeHttpResponse> => {
      if (storeCredential) guardado = SEGREDO;
      return {
        status: 200,
        body: JSON.stringify({ deviceId: 'dev-1', workerId: 'w-1', credential: true }),
      };
    },
  );
  const hasDeviceCredential = jest.fn(() => guardado !== null);
  const clearDeviceCredential = jest.fn(() => {
    guardado = null;
  });
  const control: WatchControl = {
    supported: true,
    getStatus: () => null,
    requestAuthorization: async () => true,
    startMonitoring: async () => true,
    subscribe: () => () => undefined,
    request,
    hasDeviceCredential,
    clearDeviceCredential,
    rotateInbox: () => [],
    ...overrides,
  };
  return { control, request, hasDeviceCredential, clearDeviceCredential };
}

type Deps = NonNullable<Parameters<typeof completeEnrollment>[2]>;

const deps = (control: WatchControl, extra: Partial<Deps> = {}): Deps => ({
  control,
  readToken: async () => TOKEN,
  apiUrl: () => API,
  deviceModel: () => null,
  ...extra,
});

const rejeicao = (code: string) => Object.assign(new Error(code), { code });

beforeEach(async () => {
  jest.clearAllMocks();
  await SecureStore.deleteItemAsync('swi.auth.token');
});

describe('completeEnrollment, caminho feliz', () => {
  it('envia enrollmentId e code no corpo, bearer com o token lido e storeCredential ligado', async () => {
    const { control, request } = fakeControl();
    await completeEnrollment(ENROLLMENT_ID, CODE, deps(control));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      `${API}/telemetry/v1/devices/enrollments/complete`,
      'POST',
      JSON.stringify({ enrollmentId: ENROLLMENT_ID, code: CODE }),
      { kind: 'bearer', token: TOKEN },
      true,
    );
  });

  it('inclui o modelo quando o aparelho o informa', async () => {
    const { control, request } = fakeControl();
    await completeEnrollment(
      ENROLLMENT_ID,
      CODE,
      deps(control, { deviceModel: () => 'iPhone 15' }),
    );
    expect(JSON.parse(request.mock.calls[0][2] as string)).toEqual({
      enrollmentId: ENROLLMENT_ID,
      code: CODE,
      model: 'iPhone 15',
    });
  });

  // O backend recusa modelo acima de 100 caracteres com 400 do validador, que
  // aqui viraria invalid_code e faria a pessoa conferir um código certo.
  it('corta o modelo em 100 caracteres antes de montar o corpo', async () => {
    const { control, request } = fakeControl();
    const longo = 'x'.repeat(150);
    await completeEnrollment(ENROLLMENT_ID, CODE, deps(control, { deviceModel: () => longo }));
    const corpo = JSON.parse(request.mock.calls[0][2] as string) as { model: string };
    expect(corpo.model).toHaveLength(100);
    expect(corpo.model).toBe('x'.repeat(100));
  });

  it('2xx é pareado, e o segredo nunca passa pela função', async () => {
    const { control, request } = fakeControl();
    const resultado = await completeEnrollment(ENROLLMENT_ID, CODE, deps(control));
    expect(resultado).toEqual({ paired: true });

    // O que o dublê entregou ao JavaScript trazia `true` no lugar do segredo.
    const resposta = (await request.mock.results[0].value) as NativeHttpResponse;
    expect(JSON.parse(resposta.body).credential).toBe(true);
    expect(resposta.body).not.toContain(SEGREDO);
    expect(JSON.stringify(resultado)).not.toContain(SEGREDO);
    expect(Object.keys(resultado)).toEqual(['paired']);
  });

  it('sem deps, lê o token pelo mesmo SecureStore e chave que http.ts e usa getApiUrl', async () => {
    await SecureStore.setItemAsync('swi.auth.token', 'tok-secure');
    const { control, request } = fakeControl();
    await completeEnrollment(ENROLLMENT_ID, CODE, { control });
    expect(request.mock.calls[0][0]).toBe(
      `${getApiUrl()}/telemetry/v1/devices/enrollments/complete`,
    );
    expect(request.mock.calls[0][3]).toEqual({ kind: 'bearer', token: 'tok-secure' });
  });
});

describe('completeEnrollment, antes da rede', () => {
  it('sem suporte responde unsupported sem chamar o nativo nem ler o token', async () => {
    const readToken = jest.fn(async () => TOKEN);
    const control = createWatchControl(null);
    const spy = jest.spyOn(control, 'request');
    await expect(
      completeEnrollment(ENROLLMENT_ID, CODE, { control, readToken, apiUrl: () => API }),
    ).resolves.toEqual({ paired: false, reason: 'unsupported' });
    expect(spy).not.toHaveBeenCalled();
    expect(readToken).not.toHaveBeenCalled();
  });

  it('sem token responde unauthorized sem chamar o nativo', async () => {
    const { control, request } = fakeControl();
    await expect(
      completeEnrollment(ENROLLMENT_ID, CODE, deps(control, { readToken: async () => null })),
    ).resolves.toEqual({ paired: false, reason: 'unauthorized' });
    expect(request).not.toHaveBeenCalled();
  });

  it('leitura do token que falha no aparelho é unauthorized, sem lançar', async () => {
    const { control, request } = fakeControl();
    await expect(
      completeEnrollment(
        ENROLLMENT_ID,
        CODE,
        deps(control, {
          readToken: async () => {
            throw new Error('keychain indisponível');
          },
        }),
      ),
    ).resolves.toEqual({ paired: false, reason: 'unauthorized' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('completeEnrollment, status do backend', () => {
  const respondendo = (status: number, body: string) => {
    const { control, request } = fakeControl();
    request.mockResolvedValue({ status, body });
    return control;
  };

  // O backend responde 400 para as três recusas; só a mensagem distingue.
  it.each<[string, EnrollmentFailure['reason']]>([
    ['Código de pareamento inválido', 'invalid_code'],
    ['Código de pareamento expirado', 'expired'],
    ['Código de pareamento já utilizado', 'already_used'],
  ])('400 com "%s" vira %s', async (mensagem, reason) => {
    const control = respondendo(400, nestError(400, mensagem));
    await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
      paired: false,
      reason,
    });
  });

  it('400 do validador (mensagem em lista) é código inválido', async () => {
    const control = respondendo(400, nestError(400, ['enrollmentId must be a string']));
    await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
      paired: false,
      reason: 'invalid_code',
    });
  });

  it('400 com corpo que não é JSON é código inválido, sem lançar', async () => {
    const control = respondendo(400, '<html>');
    await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
      paired: false,
      reason: 'invalid_code',
    });
  });

  it('401 é unauthorized', async () => {
    const control = respondendo(401, nestError(401, 'Unauthorized'));
    await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
      paired: false,
      reason: 'unauthorized',
    });
  });

  // A rota limita cinco tentativas por minuto, e errar um código ditado é o
  // caso comum: a pessoa precisa ouvir "aguarde", não "erro inesperado".
  it('429 é rate_limited', async () => {
    const control = respondendo(429, nestError(429, 'ThrottlerException: Too Many Requests'));
    await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
      paired: false,
      reason: 'rate_limited',
    });
  });

  it('qualquer outro status é unexpected', async () => {
    for (const status of [500, 503]) {
      const control = respondendo(status, '{}');
      await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
        paired: false,
        reason: 'unexpected',
      });
    }
  });
});

describe('completeEnrollment, rejeição do nativo', () => {
  const rejeitando = (code: string) => {
    const { control, request } = fakeControl();
    request.mockRejectedValue(rejeicao(code));
    return control;
  };

  it.each<[string, EnrollmentFailure['reason']]>([
    ['E_KEYCHAIN', 'keychain'],
    ['E_CREDENTIAL_MISSING', 'unexpected'],
    ['E_NETWORK', 'network'],
    ['E_UNSUPPORTED', 'unsupported'],
    ['E_URL', 'unexpected'],
    ['E_NO_CREDENTIAL', 'unexpected'],
  ])('%s vira %s', async (code, reason) => {
    await expect(
      completeEnrollment(ENROLLMENT_ID, CODE, deps(rejeitando(code))),
    ).resolves.toEqual({ paired: false, reason });
  });

  it('rejeição sem código conhecido é unexpected, sem lançar', async () => {
    const { control, request } = fakeControl();
    request.mockRejectedValue(new Error('qualquer coisa'));
    await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
      paired: false,
      reason: 'unexpected',
    });
  });
});

describe('completeEnrollment, chaveiro como fonte da verdade', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  // A única evidência de que ESTA tentativa gravou é o chaveiro ter virado de
  // vazio para cheio entre a foto e a falha: o Swift guardou e a resposta se
  // perdeu no caminho. Dizer "não pareado" mandaria o funcionário atrás de um
  // convite que o backend já consumiu.
  it('foto vazia, rejeição, chaveiro cheio: pareado, com aviso', async () => {
    const { control, request, hasDeviceCredential } = fakeControl();
    hasDeviceCredential.mockReturnValueOnce(false);
    request.mockImplementation(async () => {
      hasDeviceCredential.mockReturnValue(true);
      throw rejeicao('E_NETWORK');
    });
    await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
      paired: true,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/chaveiro/);
  });

  // Credencial revogada no painel continua no chaveiro até o app ver um 401 no
  // envio. Um convite novo com código errado tem de ser código errado, não
  // "pareado" por causa do que sobrou de antes.
  it('credencial pré-existente e 400: a falha é falha', async () => {
    const { control, request, hasDeviceCredential } = fakeControl();
    hasDeviceCredential.mockReturnValue(true);
    request.mockResolvedValue({ status: 400, body: nestError(400, 'Código de pareamento inválido') });
    await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
      paired: false,
      reason: 'invalid_code',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('credencial pré-existente e rejeição de rede: a falha é falha', async () => {
    const { control, request, hasDeviceCredential } = fakeControl();
    hasDeviceCredential.mockReturnValue(true);
    request.mockRejectedValue(rejeicao('E_NETWORK'));
    await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
      paired: false,
      reason: 'network',
    });
  });

  it('chaveiro que falha ao responder conta como sem credencial nas duas leituras', async () => {
    const { control, request, hasDeviceCredential } = fakeControl();
    request.mockResolvedValue({ status: 500, body: '{}' });
    hasDeviceCredential.mockImplementation(() => {
      throw new Error('chaveiro indisponível');
    });
    await expect(completeEnrollment(ENROLLMENT_ID, CODE, deps(control))).resolves.toEqual({
      paired: false,
      reason: 'unexpected',
    });
  });

  it('a foto é tirada antes do request, e a segunda leitura só na falha', async () => {
    const { control, request, hasDeviceCredential } = fakeControl();
    const ordem: string[] = [];
    hasDeviceCredential.mockImplementation(() => {
      ordem.push('chaveiro');
      return false;
    });
    request.mockImplementation(async () => {
      ordem.push('request');
      return { status: 500, body: '{}' };
    });
    await completeEnrollment(ENROLLMENT_ID, CODE, deps(control));
    expect(ordem).toEqual(['chaveiro', 'request', 'chaveiro']);
  });

  it('sem suporte não consulta o chaveiro', async () => {
    const control = createWatchControl(null);
    const spy = jest.spyOn(control, 'hasDeviceCredential');
    await completeEnrollment(ENROLLMENT_ID, CODE, { control, readToken: async () => TOKEN });
    expect(spy).not.toHaveBeenCalled();
  });

  it('sem token não consulta o chaveiro', async () => {
    const { control, hasDeviceCredential } = fakeControl();
    await completeEnrollment(ENROLLMENT_ID, CODE, deps(control, { readToken: async () => null }));
    expect(hasDeviceCredential).not.toHaveBeenCalled();
  });

  it('no caminho feliz só a foto é lida, e não há aviso', async () => {
    const { control, hasDeviceCredential } = fakeControl();
    await completeEnrollment(ENROLLMENT_ID, CODE, deps(control));
    expect(hasDeviceCredential).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
