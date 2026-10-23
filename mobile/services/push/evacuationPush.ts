import { useSyncExternalStore } from 'react';

// O push da evacuação, como o backend manda pelo serviço da Expo (PR do
// backend com o contrato de /push/tokens): o início com título, para a pessoa
// ver com o app fechado, e o início e o fim só de dados, para a tarefa ligar e
// desligar o rastreio. Todos trazem `data { type, evacuationId }`, e o
// `evacuationId` é o mesmo de GET /evacuations/active e do socket.
//
// O push é um aviso a mais para o app fechado. O socket e a consulta seguem
// sendo o caminho principal: daqui só sai a deixa para consultar na hora.

/** Canal do Android que o backend pede no push do início (`channelId`). */
export const EVACUATION_CHANNEL_ID = 'evacuation';

/** Tarefa do TaskManager que recebe o push em segundo plano. Trocar o nome órfã a anterior. */
export const PUSH_TASK_NAME = 'swi-push-notification';

export type EvacuationPushType = 'evacuation.started' | 'evacuation.ended';

export interface EvacuationPush {
  type: EvacuationPushType;
  evacuationId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Os dados do push, em objeto ou no texto JSON que a tarefa recebe. Qualquer
 * outra coisa (outro tipo de push, carga quebrada) é null.
 */
export function readEvacuationPush(data: unknown): EvacuationPush | null {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  const { type, evacuationId } = value;
  if (type !== 'evacuation.started' && type !== 'evacuation.ended') return null;
  if (typeof evacuationId !== 'string' || evacuationId.length === 0) return null;
  return { type, evacuationId };
}

/** O primeiro dos lugares possíveis que traz um push da evacuação. */
const firstPush = (candidates: unknown[]): EvacuationPush | null => {
  for (const candidate of candidates) {
    const push = readEvacuationPush(candidate);
    if (push) return push;
  }
  return null;
};

/**
 * O push da evacuação dentro do que a tarefa recebe. Duas formas: a mensagem
 * que chegou (o `data` do FCM ou do APNs, com os nossos dados em `body` e
 * copiados para `dataString`) e, só no Android, o toque na notificação com o
 * app em segundo plano ou fechado, que chega como resposta (`actionIdentifier`)
 * com os dados no conteúdo da notificação.
 */
export function evacuationPushFromTask(
  payload: unknown,
): { push: EvacuationPush; tapped: boolean } | null {
  if (!isRecord(payload)) return null;
  if ('actionIdentifier' in payload) {
    const notification = isRecord(payload.notification) ? payload.notification : null;
    const request = isRecord(notification?.request) ? notification.request : null;
    const content = isRecord(request?.content) ? request.content : null;
    const push = content ? firstPush([content.data, content.dataString]) : null;
    return push ? { push, tapped: true } : null;
  }
  const data = isRecord(payload.data) ? payload.data : null;
  const push = data ? firstPush([data.dataString, data.body, data]) : null;
  return push ? { push, tapped: false } : null;
}

/**
 * O aviso que o rastreio da evacuação usa para consultar na hora: o do socket
 * (id da notificação mais recente) e o do push. Sem push fica o do socket, do
 * jeito que era.
 */
export function combineEvacuationNotices(socket: string | null, push: string | null): string | null {
  if (push === null) return socket;
  return socket === null ? `push:${push}` : `${socket}|push:${push}`;
}

// Cada push da evacuação visto com o app aberto (recebido ou tocado) muda o
// aviso. O contador entra junto do id porque o toque chega com o mesmo id do
// recebimento, e cada um é uma deixa nova para consultar.
let notice: string | null = null;
let count = 0;
const listeners = new Set<() => void>();

export function announceEvacuationPush(id: string): void {
  count += 1;
  notice = `${id}#${count}`;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getNotice = () => notice;

/** O aviso do último push da evacuação, reativo. Null até o primeiro. */
export function useEvacuationPushNotice(): string | null {
  return useSyncExternalStore(subscribe, getNotice, getNotice);
}
