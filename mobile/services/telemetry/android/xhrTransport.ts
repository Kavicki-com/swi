// Pedido HTTP do controle do Android, pelo XMLHttpRequest e não pelo `fetch`.
//
// O motivo é a tarefa de segundo plano do Health Connect. Com o app subido sem
// tela pelo WorkManager, os timers do JavaScript não disparam: na nova
// arquitetura do RN 0.81 o `setTimeout` vai ao `JavaTimerManager.createTimer`,
// que só dispara num quadro do Choreographer, e esse quadro não roda com o app
// pausado e sem HeadlessJsTask (o expo-task-manager não abre uma). O `fetch`
// do React Native é o whatwg-fetch, que entrega a resposta dentro de um
// `setTimeout(..., 0)`: o lote chegava ao backend e a promessa nunca
// resolvia, deixando a tarefa pendurada até o sistema matá-la.
//
// O XMLHttpRequest do RN recebe load, error e timeout direto dos eventos da
// ponte de rede, sem timer no caminho. E o `timeout` dele vira o prazo da
// chamada no OkHttp, do lado nativo: vale também sem tela, onde um prazo por
// `setTimeout` não valeria.

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  /** Prazo da chamada inteira, cumprido pelo lado nativo. */
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  body: string;
}

/**
 * Resolve com qualquer status que o servidor devolva. Rejeita só quando não
 * houve resposta: rede, prazo ou aborto. A mensagem é fixa e não carrega nada
 * do pedido.
 */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

// O evento que o XMLHttpRequest passa ao handler não é lido aqui.
type XhrHandler = ((event: never) => unknown) | null;

/** O pedaço do XMLHttpRequest que este transporte usa (e que os testes dublam). */
export interface XhrLike {
  timeout: number;
  withCredentials: boolean;
  responseType: XMLHttpRequestResponseType;
  readonly status: number;
  readonly responseText: string;
  onload: XhrHandler;
  onerror: XhrHandler;
  ontimeout: XhrHandler;
  onabort: XhrHandler;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body?: string | null): void;
}

// Lido na hora do pedido, e não na criação do transporte.
const globalXhr = (): XhrLike => new XMLHttpRequest();

export function createXhrTransport(newXhr: () => XhrLike = globalXhr): HttpTransport {
  return ({ url, method, headers, body, timeoutMs }) =>
    new Promise<HttpResponse>((resolve, reject) => {
      const xhr = newXhr();
      xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
      xhr.onerror = () => reject(new Error('Falha de rede'));
      xhr.ontimeout = () => reject(new Error('Tempo esgotado'));
      xhr.onabort = () => reject(new Error('Pedido abortado'));
      // Um `open` ou `send` que lança cai no reject do próprio construtor.
      xhr.open(method, url);
      // Sem cookies, como a sessão do Swift: um Set-Cookie do caminho não pode
      // ir junto com o Authorization na chamada seguinte.
      xhr.withCredentials = false;
      xhr.responseType = 'text';
      xhr.timeout = timeoutMs;
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.send(body);
    });
}
