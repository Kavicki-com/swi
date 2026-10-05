import type { SendItem, SendOutbox } from './sendOutbox';

// Esvazia a fila de envios, um item por vez e na ordem. Um item só sai da
// fila quando o backend confirma ou recusa de vez. Repetir um envio é
// inofensivo: o `id` do item vai como Idempotency-Key e o backend devolve o
// registro já criado; perder um envio não é.

/**
 * Validade de um item. Passou disso, sai da fila com aviso: um item que nunca
 * passa (o servidor sempre responde 500, a foto nunca sobe) travaria para
 * sempre tudo o que vem atrás dele, e não há tela para cancelar um envio.
 */
export const SEND_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/** `rejected`: o servidor recusou. `expired`: passou da validade na fila. */
export type RefusalReason = 'rejected' | 'expired';

export type FailureAction = 'refuse' | 'wait' | 'unauthorized';

/** Quem fala com o backend. O item chega ao `send` já com as keys das fotos. */
export interface SendTransport {
  /** Sobe uma foto do item e devolve a referência dela. */
  upload(item: SendItem, localUri: string): Promise<string>;
  /** Faz o POST do item, com o `id` como chave do envio. */
  send(item: SendItem): Promise<unknown>;
}

/**
 * `empty`: nada a enviar. `sent`: a fila foi até o fim. `waiting`: parou numa
 * falha passageira, ou porque a sessão fechou, e o resto ficou.
 * `unauthorized`: a sessão não vale mais.
 */
export type DrainOutcome = 'empty' | 'sent' | 'waiting' | 'unauthorized';

export interface SendDrainer {
  /**
   * Manda os itens do dono. Se já há uma rodada em andamento, devolve a mesma
   * (duas juntas mandariam o mesmo item) e a rodada repassa a fila ao terminar,
   * para pegar o que entrou no meio.
   */
  drain(owner: string): Promise<DrainOutcome>;
}

interface DrainerDeps {
  outbox: SendOutbox;
  transport: SendTransport;
  now(): number;
  /**
   * A sessão que abriu esta rodada ainda é a atual? A rodada confere antes de
   * cada passo que toca a rede: o token vai no pedido na hora do envio, e um
   * envio de quem já saiu não pode sair com o token de quem entrou depois.
   */
  isCurrent(): boolean;
  onSent(item: SendItem, result: unknown): void;
  onRefused(item: SendItem, reason: RefusalReason): void;
}

const statusOf = (error: unknown) => (error as { status?: unknown } | null)?.status;
const codeOf = (error: unknown) => (error as { code?: unknown } | null)?.code;
const fromApi = (error: unknown) => (error as { apiError?: unknown } | null)?.apiError === true;

/** A rodada não é mais da sessão atual: para sem mexer no item. */
const SESSION_CLOSED = { code: 'SESSION_CLOSED' } as const;

/**
 * O que fazer com a falha de um envio.
 *
 *  - 401: a sessão acabou. Para tudo e guarda: o item é de quem está logado e
 *    sai quando a pessoa entrar de novo.
 *  - 408 e 429: passageiro, espera.
 *  - qualquer outro 4xx DA API: o servidor entendeu e recusou; repetir o mesmo
 *    corpo dá a mesma resposta.
 *  - 4xx de algo no caminho (túnel parado, proxy, firewall): a API nem viu o
 *    envio. Espera, e a validade do item cobre o caso sem saída.
 *  - foto que sumiu do aparelho: não há mais o que subir.
 *  - o resto (sem rede, prazo esgotado, 5xx): espera a próxima rodada.
 */
export function classifyFailure(error: unknown): FailureAction {
  if (codeOf(error) === 'FILE_MISSING') return 'refuse';
  const status = statusOf(error);
  if (typeof status !== 'number') return 'wait';
  if (status === 401) return 'unauthorized';
  if (status === 408 || status === 429) return 'wait';
  return status >= 400 && status < 500 && fromApi(error) ? 'refuse' : 'wait';
}

export function createSendDrainer(deps: DrainerDeps): SendDrainer {
  const { outbox, transport, now, isCurrent, onSent, onRefused } = deps;
  let running: Promise<DrainOutcome> | null = null;
  let again = false;

  // Data ilegível dá NaN, e NaN não é menor que nada: vale como vencida.
  const expired = (item: SendItem) => !(now() - Date.parse(item.createdAt) <= SEND_MAX_AGE_MS);

  /** Sobe as fotos que faltam, gravando cada key antes de seguir. */
  async function withUploadedImages(owner: string, item: SendItem): Promise<SendItem> {
    let current = item;
    for (let index = 0; index < item.images.length; index += 1) {
      const image = item.images[index];
      if (image.key !== null) continue;
      const key = await transport.upload(item, image.localUri);
      // O upload pode levar mais de um minuto. Se a pessoa saiu nesse meio, ou
      // se o item já não está na fila para receber a key, o envio para aqui.
      if (!isCurrent()) throw SESSION_CLOSED;
      if (!(await outbox.setImageKey(owner, item.id, index, key))) throw SESSION_CLOSED;
      current = {
        ...current,
        images: current.images.map((img, i) => (i === index ? { ...img, key } : img)),
      };
    }
    return current;
  }

  async function run(owner: string): Promise<DrainOutcome> {
    let handled = 0;
    for (;;) {
      if (!isCurrent()) return 'waiting';
      const [item] = await outbox.pending(owner);
      if (!item) return handled > 0 ? 'sent' : 'empty';

      if (expired(item)) {
        await outbox.remove(owner, item.id);
        onRefused(item, 'expired');
        handled += 1;
        continue;
      }

      let sent: SendItem;
      let result: unknown;
      try {
        sent = await withUploadedImages(owner, item);
        if (!isCurrent()) throw SESSION_CLOSED;
        result = await transport.send(sent);
      } catch (error) {
        if (error === SESSION_CLOSED) return 'waiting';
        const action = classifyFailure(error);
        if (action !== 'refuse') return action === 'unauthorized' ? 'unauthorized' : 'waiting';
        await outbox.remove(owner, item.id);
        onRefused(item, 'rejected');
        handled += 1;
        continue;
      }
      await outbox.remove(owner, item.id);
      onSent(sent, result);
      handled += 1;
    }
  }

  async function rounds(owner: string): Promise<DrainOutcome> {
    for (;;) {
      again = false;
      const outcome = await run(owner);
      // Rodada que parou numa falha não repassa: o motivo ainda está lá.
      if (!again || outcome === 'waiting' || outcome === 'unauthorized') return outcome;
    }
  }

  return {
    drain(owner) {
      if (running) {
        again = true;
        return running;
      }
      running = rounds(owner).finally(() => {
        running = null;
      });
      return running;
    },
  };
}
