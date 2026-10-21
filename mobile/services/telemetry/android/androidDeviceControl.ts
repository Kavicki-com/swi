import * as SecureStore from 'expo-secure-store';
import type {
  NativeAuth,
  NativeHttpResponse,
  NativeRequestErrorCode,
  WatchControl,
} from '../../../modules/swi-watch-control';
import { REQUEST_TIMEOUT_MS } from '../../api/http';
import { createXhrTransport, type HttpTransport } from './xhrTransport';

// Controle do aparelho no Android: o mesmo `WatchControl` que o envio de
// telemetria e o pareamento já consomem no iPhone, feito em JavaScript puro
// com XMLHttpRequest e `expo-secure-store`. Os dois serviços rodam sem
// mudança. Não é o `fetch` porque ele não entrega a resposta com o app sem
// tela, que é onde roda a tarefa de segundo plano (ver xhrTransport.ts).
//
// ATENÇÃO: no Android a credencial do aparelho fica visível ao JavaScript.
// No iPhone ela vive no chaveiro e o JavaScript só sabe que ela existe; aqui
// ela é lida do SecureStore para montar o cabeçalho. É decisão consciente,
// registrada no desenho do Health Connect (parte 1): não há módulo nativo
// Android, e o SecureStore cifra o valor com chave do Keystore. A promessa
// que continua valendo é a do contrato: o valor nunca sobe deste arquivo,
// nem no corpo devolvido nem em mensagem de erro.

export const DEVICE_CREDENTIAL_KEY = 'swi.telemetry.deviceCredential';

/** O pedaço do `expo-secure-store` que este controle usa (e que os testes dublam). */
export interface CredentialStore {
  /** Síncrono e pode lançar (chave do Keystore invalidada, por exemplo). */
  getItem(key: string): string | null;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface AndroidDeviceControlDeps {
  /** O padrão é o XMLHttpRequest global (`createXhrTransport`). */
  transport?: HttpTransport;
  store?: CredentialStore;
  /** Prazo da requisição inteira, do envio à leitura do corpo, cumprido pelo transporte. */
  timeoutMs?: number;
}

// Mesmo formato da rejeição do invólucro do iPhone: um Error com `code`, que
// os serviços leem por nativeErrorCode. A mensagem é sempre fixa, para nada
// vindo da rede ou do SecureStore carregar a credencial para um log.
function rejection(code: NativeRequestErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

// A mesma regra do Swift (TelemetryHttp.parseUrl): http ou https, com host.
// Por expressão, e não por `new URL`, porque o URL do React Native não
// implementa `protocol` nem `hostname`.
const HTTP_URL = /^https?:\/\/(?:[^/?#@\s]*@)?[^/?#:@\s]/i;

/**
 * Fábrica para os testes. Código de produção usa a instância única
 * `androidDeviceControl`, abaixo: o marcador de limpeza e a fila de gravação
 * só ordenam operações dentro de uma mesma instância, e o envio, o pareamento
 * e a tarefa em segundo plano precisam enxergar a mesma credencial.
 */
export function createAndroidDeviceControl(deps: AndroidDeviceControlDeps = {}): WatchControl {
  const {
    transport = createXhrTransport(),
    store = SecureStore,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = deps;

  // `clearDeviceCredential` é síncrono e o SecureStore apaga de forma
  // assíncrona. O marcador faz a revogação valer na hora: até um pareamento
  // novo gravar, não há credencial, mesmo com o item ainda no disco.
  let cleared = false;
  // Cada limpeza avança a geração. Uma gravação que começou antes de uma
  // limpeza não pode desligar o marcador ao terminar: a limpeza veio depois e
  // vence, como no chaveiro do iPhone.
  let generation = 0;
  // Apagar e gravar passam por uma fila só, na ordem em que foram pedidos, para
  // um apagar disparado antes nunca apagar uma credencial gravada depois.
  let writes: Promise<unknown> = Promise.resolve();

  // Leitura que lança conta como ausência, como no Swift: sem credencial
  // legível, o aparelho não está pareado.
  function readCredential(): string | null {
    if (cleared) return null;
    try {
      return store.getItem(DEVICE_CREDENTIAL_KEY);
    } catch {
      return null;
    }
  }

  async function writeCredential(credential: string): Promise<void> {
    const startedAt = generation;
    const write = writes.then(() => store.setItemAsync(DEVICE_CREDENTIAL_KEY, credential));
    writes = write.catch(() => undefined);
    try {
      await write;
    } catch {
      throw rejection('E_KEYCHAIN', 'SecureStore recusou a gravação da credencial');
    }
    if (startedAt === generation) cleared = false;
  }

  function authorizationFor(auth: NativeAuth): string | null {
    if (auth.kind === 'device') {
      const credential = readCredential();
      // Sem credencial, rejeita antes de tocar a rede: quem chama trata como
      // "não pareado", não como falha de envio.
      if (credential === null) throw rejection('E_NO_CREDENTIAL', 'Aparelho não pareado');
      return `Device ${credential}`;
    }
    if (auth.kind === 'bearer') return `Bearer ${auth.token}`;
    // Qualquer outro `kind` vai sem cabeçalho, como no Swift.
    return null;
  }

  // Resposta 2xx do pareamento: a credencial vai para o SecureStore e o corpo
  // sobe com `true` no lugar. Se o corpo não for um objeto com `credential` em
  // texto na raiz, a falha é ruidosa: melhor o pareamento falhar do que o
  // segredo subir intacto.
  async function storeFromBody(body: string): Promise<string> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
    const credential =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).credential
        : undefined;
    if (typeof credential !== 'string') {
      throw rejection('E_CREDENTIAL_MISSING', 'Resposta do pareamento sem credencial');
    }
    await writeCredential(credential);
    return JSON.stringify({ ...(parsed as Record<string, unknown>), credential: true });
  }

  return {
    supported: true,
    // Sem relógio e sem arquivo do Swift: nada a rotacionar, status nenhum, e
    // as ações do relógio resolvem false em vez de fingir que aconteceram.
    rotateInbox: () => [],
    getStatus: () => null,
    requestAuthorization: async () => false,
    startMonitoring: async () => false,
    subscribe: () => () => undefined,

    async request(url, method, body, auth, storeCredential): Promise<NativeHttpResponse> {
      if (!HTTP_URL.test(url)) throw rejection('E_URL', 'URL inválida');

      const headers: Record<string, string> = {};
      const authorization = authorizationFor(auth);
      if (authorization !== null) headers.Authorization = authorization;
      if (body !== null) headers['Content-Type'] = 'application/json';

      let response: NativeHttpResponse;
      try {
        // O prazo vai dentro do pedido, e não num setTimeout daqui: sem tela,
        // um timer do JavaScript não dispara.
        response = await transport({ url, method, headers, body, timeoutMs });
      } catch {
        throw rejection('E_NETWORK', 'Falha de rede no envio');
      }

      const { status } = response;
      if (!storeCredential || status < 200 || status > 299) return response;
      return { status, body: await storeFromBody(response.body) };
    },

    hasDeviceCredential: () => readCredential() !== null,

    clearDeviceCredential() {
      cleared = true;
      generation += 1;
      // Disparado e não esperado: o contrato é síncrono. Falha ao apagar não
      // vira rejeição solta; o marcador já responde "sem credencial", e o
      // próximo 401 tenta apagar de novo.
      writes = writes.then(() => store.deleteItemAsync(DEVICE_CREDENTIAL_KEY)).catch(() => undefined);
    },
  };
}

// A instância do processo. Criar não toca o SecureStore nem a rede, então
// importar este arquivo em iOS, web ou Jest não tem efeito nenhum.
export const androidDeviceControl: WatchControl = createAndroidDeviceControl();
