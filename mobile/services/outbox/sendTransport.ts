import type { ChatBackend } from '../chat/types';
import type { JourneyBackend, JourneySend } from '../journey/types';
import type { ReportsBackend } from '../reports/types';
import type { SendTransport } from './sendDrain';
import type { JourneyItem, SendItem } from './sendOutbox';

// Liga cada tipo de item da fila à chamada do backend dele. O `id` do item vai
// como chave do envio, e o corpo sai só do que está gravado no item: é o que
// garante que a segunda tentativa leve exatamente o mesmo corpo da primeira.

interface TransportBackends {
  chat: Pick<ChatBackend, 'uploadImage' | 'sendMessage'>;
  reports: Pick<ReportsBackend, 'uploadImage' | 'create' | 'addComment'>;
  journey: Pick<
    JourneyBackend,
    | 'uploadImage'
    | 'addTaskPhoto'
    | 'startTask'
    | 'completeTask'
    | 'cancelTask'
    | 'pauseJourney'
    | 'resumeJourney'
    | 'endJourney'
  >;
}

/** As keys das fotos do item. Foto sem key é item que ainda não pode sair. */
function imageKeys(item: SendItem): string[] {
  return item.images.map((image) => {
    if (image.key === null) throw new Error('Foto do envio ainda sem key');
    return image.key;
  });
}

const hasId = (value: unknown): boolean => {
  const id = (value as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id !== '';
};

const isJourneySession = (value: unknown): boolean => {
  const state = (value as { state?: unknown } | null | undefined)?.state;
  return state === 'idle' || state === 'ongoing' || state === 'paused';
};

/**
 * A resposta é da API? O registro criado volta com `id`. As ações da jornada
 * não têm `id` na raiz: a da tarefa devolve `{ journey, task }` e a do turno
 * devolve o estado dele.
 */
function isApiAnswer(item: SendItem, result: unknown): boolean {
  switch (item.kind) {
    case 'journey.task.start':
    case 'journey.task.complete':
    case 'journey.task.cancel': {
      const answer = result as { journey?: unknown; task?: unknown } | null | undefined;
      return hasId(answer?.task) && isJourneySession(answer?.journey);
    }
    case 'journey.pause':
    case 'journey.resume':
    case 'journey.end':
      return isJourneySession(result);
    default:
      return hasId(result);
  }
}

/** A chave e a hora do toque, as duas iguais em toda tentativa. */
const journeySend = (item: JourneyItem): JourneySend => ({
  idempotencyKey: item.id,
  occurredAt: item.createdAt,
});

export function createSendTransport({ chat, reports, journey }: TransportBackends): SendTransport {
  async function post(item: SendItem): Promise<unknown> {
    const keys = imageKeys(item);
    switch (item.kind) {
      case 'chat.message':
        return chat.sendMessage(item.conversationId, item.body, {
          imageKey: keys[0],
          idempotencyKey: item.id,
        });
      case 'report':
        return reports.create(
          {
            title: item.title,
            summary: item.summary,
            details: item.details,
            responsibles: item.responsibles,
            imageKeys: keys,
          },
          item.id,
        );
      case 'report.comment':
        return reports.addComment(item.reportId, item.body, item.id);
      case 'journey.task.start':
        return journey.startTask(item.taskId, journeySend(item));
      case 'journey.task.complete':
        return journey.completeTask(item.taskId, journeySend(item));
      case 'journey.task.cancel':
        return journey.cancelTask(item.taskId, journeySend(item));
      case 'journey.pause':
        return journey.pauseJourney(journeySend(item));
      case 'journey.resume':
        return journey.resumeJourney(journeySend(item));
      case 'journey.end':
        return journey.endJourney(journeySend(item));
      case 'journey.task.photo':
        // Sem chave de envio: a mesma foto enviada de novo não duplica.
        return journey.addTaskPhoto(item.taskId, keys[0]);
    }
  }

  return {
    upload(item, localUri) {
      switch (item.kind) {
        case 'chat.message':
          return chat.uploadImage(localUri);
        case 'journey.task.photo':
          return journey.uploadImage(localUri);
        default:
          return reports.uploadImage(localUri);
      }
    },

    async send(item) {
      const result = await post(item);
      // Um 200 de página de manutenção ou de proxy chega aqui como {}. Tirar o
      // item da fila por causa dele seria perder o envio em silêncio. O erro
      // sai sem `status`: a fila espera e repete, com a mesma chave.
      if (!isApiAnswer(item, result)) throw new Error('Resposta do envio sem o registro criado');
      return result;
    },
  };
}
