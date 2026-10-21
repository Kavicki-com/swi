import { nativeErrorCode, type WatchControl } from '../../../modules/swi-watch-control';
import { REQUEST_TIMEOUT_MS } from '../../api/http';
import { completeEnrollment } from '../deviceEnrollment';
import { createTelemetryOutbox, type OutboxStorage } from '../telemetryOutbox';
import { createTelemetryUploader } from '../telemetryUploader';
import {
  androidDeviceControl,
  createAndroidDeviceControl,
  DEVICE_CREDENTIAL_KEY,
  type CredentialStore,
} from './androidDeviceControl';
import type { HttpTransport } from './xhrTransport';

jest.mock('expo-secure-store', () => {
  const itens = new Map<string, string>();
  return {
    getItem: jest.fn((k: string) => itens.get(k) ?? null),
    getItemAsync: jest.fn(async (k: string) => itens.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      itens.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      itens.delete(k);
    }),
  };
});

const API = 'https://api.exemplo';
const URL_LOTES = `${API}/telemetry/v1/batches`;
const URL_PAREAMENTO = `${API}/telemetry/v1/devices/enrollments/complete`;
const TOKEN = 'token-do-funcionario';

// O segredo só pode aparecer no SecureStore falso. Nada que o controle devolva
// ou rejeite pode conter esta string.
const SEGREDO = 'dev-1.0123456789abcdef0123456789abcdef';
const OUTRO_SEGREDO = 'dev-2.fedcba9876543210fedcba9876543210';

const pareado = (credential: string = SEGREDO) =>
  JSON.stringify({ deviceId: 'd1', workerId: 'w1', credential });

interface FakeStore extends CredentialStore {
  itens: Map<string, string>;
  getItem: jest.Mock<string | null, [string]>;
  setItemAsync: jest.Mock<Promise<void>, [string, string]>;
  deleteItemAsync: jest.Mock<Promise<void>, [string]>;
}

function fakeStore(inicial: string | null = null): FakeStore {
  const itens = new Map<string, string>();
  if (inicial !== null) itens.set(DEVICE_CREDENTIAL_KEY, inicial);
  return {
    itens,
    getItem: jest.fn((key: string) => itens.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      itens.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      itens.delete(key);
    }),
  };
}

// A próxima chamada do mock fica pendente, sem efeito no disco, até a função
// devolvida ser chamada: só então o efeito acontece e a promessa resolve.
function segurar<A extends unknown[]>(
  mock: jest.Mock<Promise<void>, A>,
  efeito: (...args: A) => void,
): () => void {
  let soltar: () => void = () => undefined;
  mock.mockImplementationOnce(
    (...args: A) =>
      new Promise<void>((resolve) => {
        soltar = () => {
          efeito(...args);
          resolve();
        };
      }),
  );
  return () => soltar();
}

function fakeTransport(status = 200, body = '{}') {
  return jest.fn<ReturnType<HttpTransport>, Parameters<HttpTransport>>(async () => ({
    status,
    body,
  }));
}

const headersDe = (fetch: jest.Mock, chamada = 0) =>
  (fetch.mock.calls[chamada][0] as { headers: Record<string, string> }).headers;

// Os dois pedidos que os serviços fazem: concluir o pareamento e enviar lote.
const parear = (control: WatchControl) =>
  control.request(URL_PAREAMENTO, 'POST', '{}', { kind: 'bearer', token: TOKEN }, true);
const enviar = (control: WatchControl, url = URL_LOTES) =>
  control.request(url, 'POST', '{}', { kind: 'device' }, false);

const esperar = () => new Promise((resolve) => setTimeout(resolve, 0));

async function rejeicao(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('a promessa resolveu, e devia rejeitar');
}

// Nem a mensagem nem nada serializável do erro pode carregar o segredo.
function semSegredo(valor: unknown) {
  const texto = JSON.stringify(valor, Object.getOwnPropertyNames(valor ?? {}));
  expect(texto).not.toContain(SEGREDO);
  expect(String((valor as { message?: unknown })?.message ?? '')).not.toContain(SEGREDO);
}

describe('createAndroidDeviceControl: request com bearer', () => {
  it('manda Bearer e Content-Type e devolve status e corpo em texto', async () => {
    const fetch = fakeTransport(201, '{"ok":true}');
    const control = createAndroidDeviceControl({ transport: fetch, store: fakeStore() });

    const res = await control.request(
      URL_PAREAMENTO,
      'POST',
      '{"code":"1"}',
      { kind: 'bearer', token: TOKEN },
      false,
    );

    expect(res).toEqual({ status: 201, body: '{"ok":true}' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toMatchObject({
      url: URL_PAREAMENTO,
      method: 'POST',
      body: '{"code":"1"}',
    });
    expect(headersDe(fetch)).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
  });

  it('sem corpo, não manda corpo nem Content-Type, como o Swift', async () => {
    const fetch = fakeTransport(200, 'x');
    const control = createAndroidDeviceControl({ transport: fetch, store: fakeStore() });

    await control.request(URL_LOTES, 'GET', null, { kind: 'bearer', token: TOKEN }, false);

    expect(fetch.mock.calls[0][0].body).toBeNull();
    expect(headersDe(fetch)).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('kind desconhecido vai sem Authorization, como o Swift', async () => {
    const fetch = fakeTransport();
    const control = createAndroidDeviceControl({ transport: fetch, store: fakeStore(SEGREDO) });

    await control.request(URL_LOTES, 'POST', '{}', { kind: 'outro' } as never, false);

    expect(headersDe(fetch)).toEqual({ 'Content-Type': 'application/json' });
  });
});

describe('createAndroidDeviceControl: request com device', () => {
  it('sem credencial guardada rejeita com E_NO_CREDENTIAL antes de tocar a rede', async () => {
    const fetch = fakeTransport();
    const control = createAndroidDeviceControl({ transport: fetch, store: fakeStore() });

    const erro = await rejeicao(enviar(control));

    expect(nativeErrorCode(erro)).toBe('E_NO_CREDENTIAL');
    expect(fetch).not.toHaveBeenCalled();
    expect(control.hasDeviceCredential()).toBe(false);
  });

  it('SecureStore que lança na leitura conta como sem credencial, no envio e na pergunta', async () => {
    const fetch = fakeTransport();
    const store = fakeStore(SEGREDO);
    store.getItem.mockImplementation(() => {
      throw new Error('chave do Keystore inválida');
    });
    const control = createAndroidDeviceControl({ transport: fetch, store });

    const erro = await rejeicao(enviar(control));

    expect(nativeErrorCode(erro)).toBe('E_NO_CREDENTIAL');
    expect(fetch).not.toHaveBeenCalled();
    expect(control.hasDeviceCredential()).toBe(false);
  });

  it('com credencial monta Authorization: Device <credencial>', async () => {
    const fetch = fakeTransport(202, '{"accepted":[]}');
    const control = createAndroidDeviceControl({ transport: fetch, store: fakeStore(SEGREDO) });

    const res = await enviar(control);

    expect(res).toEqual({ status: 202, body: '{"accepted":[]}' });
    expect(headersDe(fetch).Authorization).toBe(`Device ${SEGREDO}`);
    expect(control.hasDeviceCredential()).toBe(true);
  });
});

describe('createAndroidDeviceControl: request com storeCredential', () => {
  it('2xx com credential grava no SecureStore e devolve o corpo com true no lugar', async () => {
    const store = fakeStore();
    const control = createAndroidDeviceControl({ transport: fakeTransport(201, pareado()), store });

    const res = await parear(control);

    expect(store.setItemAsync).toHaveBeenCalledWith(DEVICE_CREDENTIAL_KEY, SEGREDO);
    expect(res.status).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ deviceId: 'd1', workerId: 'w1', credential: true });
    expect(res.body).not.toContain(SEGREDO);
    expect(control.hasDeviceCredential()).toBe(true);
  });

  it.each([
    ['sem a chave', '{"deviceId":"d1"}'],
    ['credential que não é texto', '{"credential":123}'],
    ['corpo que não é JSON', 'ok'],
    ['JSON que não é objeto', '["credential"]'],
    ['JSON nulo', 'null'],
  ])('2xx %s rejeita com E_CREDENTIAL_MISSING e não grava', async (_caso, body) => {
    const store = fakeStore();
    const control = createAndroidDeviceControl({ transport: fakeTransport(200, body), store });

    const erro = await rejeicao(parear(control));

    expect(nativeErrorCode(erro)).toBe('E_CREDENTIAL_MISSING');
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });

  it('SecureStore que recusa gravar rejeita com E_KEYCHAIN, sem o segredo no erro', async () => {
    const store = fakeStore();
    store.setItemAsync.mockRejectedValue(new Error(`falhou ao gravar ${SEGREDO}`));
    const control = createAndroidDeviceControl({ transport: fakeTransport(201, pareado()), store });

    const erro = await rejeicao(parear(control));

    expect(nativeErrorCode(erro)).toBe('E_KEYCHAIN');
    semSegredo(erro);
    expect(control.hasDeviceCredential()).toBe(false);
  });

  // Status de erro é resposta, não rejeição; e fora do 2xx nada é gravado,
  // mesmo com credential no corpo.
  it.each([199, 300, 400, 500])('status %p sobe intacto e não grava', async (status) => {
    const store = fakeStore();
    const control = createAndroidDeviceControl({ transport: fakeTransport(status, pareado()), store });

    await expect(parear(control)).resolves.toEqual({ status, body: pareado() });
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });

  it('sem storeCredential, um 2xx com credential sobe cru e não grava', async () => {
    const store = fakeStore();
    const control = createAndroidDeviceControl({ transport: fakeTransport(200, pareado()), store });

    const res = await control.request(
      URL_PAREAMENTO,
      'POST',
      '{}',
      { kind: 'bearer', token: TOKEN },
      false,
    );

    expect(res.body).toBe(pareado());
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });
});

describe('createAndroidDeviceControl: falhas de rede e de URL', () => {
  it('transporte que rejeita (rede, prazo, aborto) vira E_NETWORK', async () => {
    const fetch = jest.fn<ReturnType<HttpTransport>, Parameters<HttpTransport>>(async () => {
      throw new Error(`Tempo esgotado com ${SEGREDO}`);
    });
    const control = createAndroidDeviceControl({ transport: fetch, store: fakeStore(SEGREDO) });

    const erro = await rejeicao(enviar(control));

    expect(nativeErrorCode(erro)).toBe('E_NETWORK');
    semSegredo(erro);
  });

  // O prazo vai dentro do pedido, para o transporte cumprir do lado nativo:
  // um setTimeout daqui não dispara com o app sem tela.
  it('o prazo vai no próprio pedido, com o REQUEST_TIMEOUT_MS de padrão', async () => {
    const fetch = fakeTransport();
    await enviar(createAndroidDeviceControl({ transport: fetch, store: fakeStore(SEGREDO) }));
    await enviar(
      createAndroidDeviceControl({ transport: fetch, store: fakeStore(SEGREDO), timeoutMs: 5 }),
    );

    expect(fetch.mock.calls[0][0].timeoutMs).toBe(REQUEST_TIMEOUT_MS);
    expect(fetch.mock.calls[1][0].timeoutMs).toBe(5);
  });

  it('não agenda timer nenhum: a resposta chega sem o relógio andar', async () => {
    jest.useFakeTimers();
    try {
      const control = createAndroidDeviceControl({
        transport: fakeTransport(202, '{}'),
        store: fakeStore(SEGREDO),
      });

      await expect(enviar(control)).resolves.toEqual({ status: 202, body: '{}' });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['localhost:3000', 'ftp://api.exemplo/x', 'https://', 'https:///x', 'não é url', ''])(
    'URL %p rejeita com E_URL sem tocar a rede',
    async (url) => {
      const fetch = fakeTransport();
      const control = createAndroidDeviceControl({ transport: fetch, store: fakeStore(SEGREDO) });

      const erro = await rejeicao(enviar(control, url));

      expect(nativeErrorCode(erro)).toBe('E_URL');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('aceita http com porta, como o backend local', async () => {
    const fetch = fakeTransport();
    const control = createAndroidDeviceControl({ transport: fetch, store: fakeStore(SEGREDO) });

    await enviar(control, 'http://10.0.2.2:3000/x');

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('createAndroidDeviceControl: limpar a credencial', () => {
  it('responde false na hora, antes do apagar terminar, e o envio não usa a revogada', async () => {
    const store = fakeStore(SEGREDO);
    const soltarApagar = segurar(store.deleteItemAsync, (key) => store.itens.delete(key));
    const fetch = fakeTransport();
    const control = createAndroidDeviceControl({ transport: fetch, store });

    expect(control.clearDeviceCredential()).toBeUndefined();
    expect(control.hasDeviceCredential()).toBe(false);

    // O item ainda está lá, mas o envio não pode usar a credencial revogada.
    const erro = await rejeicao(enviar(control));
    expect(nativeErrorCode(erro)).toBe('E_NO_CREDENTIAL');
    expect(fetch).not.toHaveBeenCalled();
    expect(store.deleteItemAsync).toHaveBeenCalledWith(DEVICE_CREDENTIAL_KEY);
    expect(store.itens.has(DEVICE_CREDENTIAL_KEY)).toBe(true);

    soltarApagar();
    await esperar();
    expect(control.hasDeviceCredential()).toBe(false);
    expect(store.itens.has(DEVICE_CREDENTIAL_KEY)).toBe(false);
  });

  it.each([
    ['rejeita', () => Promise.reject(new Error('falhou'))],
    [
      'lança na hora',
      () => {
        throw new Error('lançou');
      },
    ],
  ])('apagar que %s não escapa e a resposta segue false', async (_caso, apagar) => {
    const store = fakeStore(SEGREDO);
    store.deleteItemAsync.mockImplementation(apagar);
    const control = createAndroidDeviceControl({ transport: fakeTransport(), store });

    expect(() => control.clearDeviceCredential()).not.toThrow();
    await esperar();

    expect(control.hasDeviceCredential()).toBe(false);
  });

  it('um pareamento novo depois de limpar grava só depois do apagar e vale de novo', async () => {
    const store = fakeStore(SEGREDO);
    const soltarApagar = segurar(store.deleteItemAsync, (key) => store.itens.delete(key));
    const fetch = fakeTransport(201, pareado(OUTRO_SEGREDO));
    const control = createAndroidDeviceControl({ transport: fetch, store });

    control.clearDeviceCredential();
    const pedido = parear(control);
    await esperar();
    // A gravação espera o apagar disparado antes dela.
    expect(store.setItemAsync).not.toHaveBeenCalled();

    soltarApagar();
    await pedido;

    expect(store.itens.get(DEVICE_CREDENTIAL_KEY)).toBe(OUTRO_SEGREDO);
    expect(control.hasDeviceCredential()).toBe(true);

    fetch.mockImplementation(async () => ({ status: 202, body: '{}' }));
    await enviar(control);
    expect(headersDe(fetch, 1).Authorization).toBe(`Device ${OUTRO_SEGREDO}`);
  });

  it('limpar durante a gravação de um pareamento vence: fica sem credencial', async () => {
    const store = fakeStore();
    const soltarGravar = segurar(store.setItemAsync, (key, value) => store.itens.set(key, value));
    const soltarApagar = segurar(store.deleteItemAsync, (key) => store.itens.delete(key));
    const control = createAndroidDeviceControl({ transport: fakeTransport(201, pareado()), store });

    const pedido = parear(control);
    await esperar();
    expect(store.setItemAsync).toHaveBeenCalled();

    control.clearDeviceCredential();
    soltarGravar();
    await pedido;

    // O item gravado ainda está no disco, com o apagar pendente: quem responde
    // é o marcador, que a gravação anterior à limpeza não pode desligar.
    expect(store.itens.get(DEVICE_CREDENTIAL_KEY)).toBe(SEGREDO);
    expect(control.hasDeviceCredential()).toBe(false);

    soltarApagar();
    await esperar();
    expect(store.itens.has(DEVICE_CREDENTIAL_KEY)).toBe(false);
    expect(control.hasDeviceCredential()).toBe(false);
  });
});

describe('createAndroidDeviceControl: o resto do WatchControl é inerte', () => {
  const control = createAndroidDeviceControl({ transport: fakeTransport(), store: fakeStore() });

  it('supported true, sem inbox, sem status e sem relógio', async () => {
    expect(control.supported).toBe(true);
    expect(control.rotateInbox()).toEqual([]);
    expect(control.getStatus()).toBeNull();
    await expect(control.requestAuthorization()).resolves.toBe(false);
    await expect(control.startMonitoring()).resolves.toBe(false);
  });

  it('subscribe nunca chama o ouvinte e devolve um cancelar inerte', () => {
    const ouvinte = jest.fn();
    const cancelar = control.subscribe(ouvinte);

    expect(cancelar()).toBeUndefined();
    expect(ouvinte).not.toHaveBeenCalled();
  });
});

describe('androidDeviceControl: a instância do processo', () => {
  const fetchOriginal = global.fetch;
  const xhrOriginal = global.XMLHttpRequest;
  afterEach(() => {
    global.fetch = fetchOriginal;
    global.XMLHttpRequest = xhrOriginal;
  });

  // O fetch do React Native só entrega a resposta dentro de um setTimeout, e
  // com o app sem tela (a tarefa de segundo plano) esse timer nunca dispara:
  // o lote chegava ao backend e a tarefa ficava pendurada. Por isso a
  // instância vai pelo XMLHttpRequest, e o fetch não pode ser tocado.
  it('é uma só, e usa o XMLHttpRequest global (nunca o fetch) e o expo-secure-store', async () => {
    const SecureStore = jest.requireMock<{ getItem: jest.Mock; setItemAsync: jest.Mock }>(
      'expo-secure-store',
    );
    const fetch = jest.fn();
    global.fetch = fetch as unknown as typeof global.fetch;
    const abertos: string[] = [];
    global.XMLHttpRequest = jest.fn(() => {
      const xhr = {
        status: 0,
        responseText: '',
        onload: null as (() => void) | null,
        open: (_method: string, url: string) => abertos.push(url),
        setRequestHeader: () => undefined,
        send: () => {
          xhr.status = 201;
          xhr.responseText = pareado();
          void Promise.resolve().then(() => xhr.onload?.());
        },
      };
      return xhr;
    }) as unknown as typeof XMLHttpRequest;
    const deNovo = jest.requireActual<typeof import('./androidDeviceControl')>(
      './androidDeviceControl',
    );

    expect(deNovo.androidDeviceControl).toBe(androidDeviceControl);
    expect(androidDeviceControl.supported).toBe(true);

    await parear(androidDeviceControl);

    expect(fetch).not.toHaveBeenCalled();
    expect(abertos).toEqual([URL_PAREAMENTO]);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(DEVICE_CREDENTIAL_KEY, SEGREDO);
    expect(androidDeviceControl.hasDeviceCredential()).toBe(true);
    expect(SecureStore.getItem).toHaveBeenCalledWith(DEVICE_CREDENTIAL_KEY);
  });
});

// Os consumidores de verdade, sem mudança, sobre o controle do Android.
describe('createAndroidDeviceControl: pareamento e envio rodam sem mudança', () => {
  function memoryStorage(): OutboxStorage {
    let text: string | null = null;
    return {
      read: async () => text,
      write: async (next) => {
        text = next;
      },
    };
  }

  it('completeEnrollment pareia, e o segredo nunca chega a quem chamou', async () => {
    const store = fakeStore();
    const fetch = fakeTransport(201, pareado());
    const control = createAndroidDeviceControl({ transport: fetch, store });

    const result = await completeEnrollment('482910', {
      control,
      readToken: async () => TOKEN,
      apiUrl: () => API,
    });

    expect(result).toEqual({ paired: true });
    expect(fetch.mock.calls[0][0].url).toBe(URL_PAREAMENTO);
    expect(store.itens.get(DEVICE_CREDENTIAL_KEY)).toBe(SEGREDO);
    expect(JSON.stringify(result)).not.toContain(SEGREDO);
  });

  it('o 401 do envio limpa a credencial e o aparelho fica sem pareamento', async () => {
    const store = fakeStore(SEGREDO);
    const fetch = fakeTransport(401, '{"statusCode":401}');
    const control = createAndroidDeviceControl({ transport: fetch, store });
    const outbox = createTelemetryOutbox(memoryStorage());
    await outbox.append({
      eventId: '00000000-0000-4000-8000-000000000001',
      monitoringSessionId: '11111111-1111-4111-8111-111111111111',
      sequence: 0,
      eventTime: '2026-10-20T12:00:00.000Z',
      origin: 'REAL',
      measurements: { heartRate: { value: 72, unit: 'bpm', source: 'APPLE_WATCH' } },
    });
    const uploader = createTelemetryUploader({ outbox, control, apiUrl: () => API });

    const desfecho = await uploader.uploadPending();

    expect(headersDe(fetch).Authorization).toBe(`Device ${SEGREDO}`);
    expect(desfecho.outcome).toBe('unpaired');
    expect(control.hasDeviceCredential()).toBe(false);
    expect(store.deleteItemAsync).toHaveBeenCalledWith(DEVICE_CREDENTIAL_KEY);
  });
});
