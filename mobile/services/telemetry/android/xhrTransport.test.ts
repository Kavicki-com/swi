import { createXhrTransport, type XhrLike } from './xhrTransport';

// Um XMLHttpRequest falso que guarda o que recebeu e só responde quando o
// teste manda, como a ponte de rede do React Native.
class FakeXhr implements XhrLike {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  sent: string | null | undefined;
  timeout = 0;
  withCredentials = true;
  responseType: XMLHttpRequestResponseType = '';
  status = 0;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body?: string | null) {
    this.sent = body;
  }

  responder(status: number, text: string) {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

function montar() {
  const xhrs: FakeXhr[] = [];
  const transport = createXhrTransport(() => {
    const xhr = new FakeXhr();
    xhrs.push(xhr);
    return xhr;
  });
  return { transport, xhrs };
}

const PEDIDO = {
  url: 'https://api.exemplo/telemetry/v1/batches',
  method: 'POST',
  headers: { Authorization: 'Device x', 'Content-Type': 'application/json' },
  body: '{"events":[]}',
  timeoutMs: 15_000,
};

async function rejeicao(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('a promessa resolveu, e devia rejeitar');
}

describe('createXhrTransport', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('abre, manda cabeçalhos e corpo, sem cookies, com o prazo no próprio pedido', () => {
    const { transport, xhrs } = montar();

    void transport(PEDIDO);

    const [xhr] = xhrs;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(PEDIDO.url);
    expect(xhr.headers).toEqual(PEDIDO.headers);
    expect(xhr.sent).toBe('{"events":[]}');
    expect(xhr.timeout).toBe(15_000);
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.responseType).toBe('text');
  });

  it('sem corpo, manda null', () => {
    const { transport, xhrs } = montar();

    void transport({ ...PEDIDO, method: 'GET', body: null });

    expect(xhrs[0].sent).toBeNull();
  });

  // O motivo deste transporte existir: sem tela, os timers do JavaScript não
  // disparam, e o fetch do React Native só resolve dentro de um setTimeout.
  it('resolve no load com status e corpo sem nenhum timer andar', async () => {
    jest.useFakeTimers();
    const { transport, xhrs } = montar();

    const pedido = transport(PEDIDO);
    xhrs[0].responder(201, '{"acceptedEventIds":[]}');

    await expect(pedido).resolves.toEqual({ status: 201, body: '{"acceptedEventIds":[]}' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('status de erro do servidor é resposta, não rejeição', async () => {
    const { transport, xhrs } = montar();

    const pedido = transport(PEDIDO);
    xhrs[0].responder(503, 'fora');

    await expect(pedido).resolves.toEqual({ status: 503, body: 'fora' });
  });

  it.each([
    ['error', 'onerror'],
    ['timeout', 'ontimeout'],
    ['abort', 'onabort'],
  ] as const)('%s rejeita', async (_caso, evento) => {
    const { transport, xhrs } = montar();

    const pedido = transport(PEDIDO);
    xhrs[0][evento]?.();

    expect(await rejeicao(pedido)).toBeInstanceOf(Error);
  });

  it('open que lança rejeita em vez de escapar', async () => {
    const transport = createXhrTransport(() => {
      const xhr = new FakeXhr();
      xhr.open = () => {
        throw new Error('URL recusada');
      };
      return xhr;
    });

    expect(await rejeicao(transport(PEDIDO))).toBeInstanceOf(Error);
  });

  it('o padrão é o XMLHttpRequest global, lido na hora do pedido', () => {
    const original = global.XMLHttpRequest;
    const criados: FakeXhr[] = [];
    global.XMLHttpRequest = jest.fn(() => {
      const xhr = new FakeXhr();
      criados.push(xhr);
      return xhr;
    }) as unknown as typeof XMLHttpRequest;
    try {
      void createXhrTransport()(PEDIDO);
      expect(criados).toHaveLength(1);
    } finally {
      global.XMLHttpRequest = original;
    }
  });
});
