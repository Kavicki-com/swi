import type { ChatBackend } from '../chat/types';
import type { ReportsBackend } from '../reports/types';
import type { SendTransport } from './sendDrain';
import type { SendItem } from './sendOutbox';

// Liga cada tipo de item da fila à chamada do backend dele. O `id` do item vai
// como chave do envio, e o corpo sai só do que está gravado no item: é o que
// garante que a segunda tentativa leve exatamente o mesmo corpo da primeira.

interface TransportBackends {
  chat: Pick<ChatBackend, 'uploadImage' | 'sendMessage'>;
  reports: Pick<ReportsBackend, 'uploadImage' | 'create' | 'addComment'>;
}

/** As keys das fotos do item. Foto sem key é item que ainda não pode sair. */
function imageKeys(item: SendItem): string[] {
  return item.images.map((image) => {
    if (image.key === null) throw new Error('Foto do envio ainda sem key');
    return image.key;
  });
}

/** O registro criado sempre volta com `id`. Sem ele, quem respondeu não foi a API. */
const isCreatedRecord = (result: unknown): boolean => {
  const id = (result as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id !== '';
};

export function createSendTransport({ chat, reports }: TransportBackends): SendTransport {
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
    }
  }

  return {
    upload(item, localUri) {
      return item.kind === 'chat.message'
        ? chat.uploadImage(localUri)
        : reports.uploadImage(localUri);
    },

    async send(item) {
      const result = await post(item);
      // Um 200 de página de manutenção ou de proxy chega aqui como {}. Tirar o
      // item da fila por causa dele seria perder o envio em silêncio. O erro
      // sai sem `status`: a fila espera e repete, com a mesma chave.
      if (!isCreatedRecord(result)) throw new Error('Resposta do envio sem o registro criado');
      return result;
    },
  };
}
