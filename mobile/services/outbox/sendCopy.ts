import type { RefusalReason } from './sendDrain';
import type { SendItem } from './sendOutbox';

// Textos da fila de envios. Nenhuma tela do Figma desenha envio pendente ou
// recusado: a redação abaixo foi aprovada à parte e entra em campos que o DS
// já tem (hora do balão, rótulo da tag, data do comentário, Toast).

/** No lugar da hora do balão, da data do comentário e do rótulo do cartão. */
export const PENDING_LABEL = 'Aguardando envio';

/** No lugar da hora do balão que o servidor recusou. */
export const REFUSED_LABEL = 'Não enviada';

/** Toast de alerta quando a fila está no teto e o novo envio não entra. */
export const QUEUE_FULL_TITLE =
  'Há muitos envios aguardando conexão. Tente de novo quando o sinal voltar.';

/**
 * Toast único nas telas da jornada enquanto houver ação dela esperando o
 * sinal: a tela já mudou, o servidor ainda não sabe.
 */
export const JOURNEY_WAITING_TITLE =
  'Sem conexão. Suas ações serão enviadas quando o sinal voltar.';

/** Título do Toast de recusa: diz o que não foi enviado. */
export function refusalTitle(item: SendItem): string {
  switch (item.kind) {
    case 'chat.message':
      return 'Não foi possível enviar a mensagem.';
    case 'report':
      return `Não foi possível enviar o relatório "${item.title}".`;
    case 'report.comment':
      return 'Não foi possível enviar o comentário.';
    case 'journey.task.start':
      return `Não foi possível iniciar a tarefa "${item.taskTitle}".`;
    case 'journey.task.complete':
      return `Não foi possível finalizar a tarefa "${item.taskTitle}".`;
    case 'journey.task.cancel':
      return `Não foi possível cancelar a tarefa "${item.taskTitle}".`;
    case 'journey.pause':
      return 'Não foi possível pausar a jornada.';
    case 'journey.resume':
      return 'Não foi possível retomar a jornada.';
    case 'journey.end':
      return 'Não foi possível finalizar a jornada.';
    case 'journey.task.photo':
      return `Não foi possível enviar a foto da tarefa "${item.taskTitle}".`;
  }
}

/** Mensagem do Toast de recusa: diz por quê. */
export function refusalMessage(reason: RefusalReason): string {
  return reason === 'expired'
    ? 'O envio expirou depois de 3 dias sem conexão.'
    : 'O servidor recusou o envio.';
}
