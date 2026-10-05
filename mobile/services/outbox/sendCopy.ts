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

/** Título do Toast de recusa: diz o que não foi enviado. */
export function refusalTitle(item: SendItem): string {
  switch (item.kind) {
    case 'chat.message':
      return 'Não foi possível enviar a mensagem.';
    case 'report':
      return `Não foi possível enviar o relatório "${item.title}".`;
    case 'report.comment':
      return 'Não foi possível enviar o comentário.';
  }
}

/** Mensagem do Toast de recusa: diz por quê. */
export function refusalMessage(reason: RefusalReason): string {
  return reason === 'expired'
    ? 'O envio expirou depois de 3 dias sem conexão.'
    : 'O servidor recusou o envio.';
}
