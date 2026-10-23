import type { HelpRequestView } from './types';

// Textos do estado do pedido de ajuda dentro do procedimento de evacuação.
// O Figma não desenha esses estados: os textos abaixo são propostas que
// aguardam aprovação, reunidas aqui para a troca ser num lugar só.
export const HELP_COPY = {
  sending: 'Enviando o pedido de ajuda.',
  failed: 'Não foi possível enviar o pedido de ajuda.',
  retry: 'Tentar de novo',
  sent: 'Pedido de ajuda enviado à central.',
  attended: 'A central recebeu seu pedido de ajuda.',
  rescuerOnTheWay: 'Socorrista a caminho.',
  rescuerArrived: 'O socorrista chegou ao seu local.',
} as const;

export interface HelpNotice {
  variant: 'info' | 'success' | 'error';
  title: string;
  /** Mostra o botão de nova tentativa. */
  retry: boolean;
}

export interface HelpNoticeInput {
  helpRequest: HelpRequestView | null;
  sending: boolean;
  failed: boolean;
}

/**
 * A faixa de estado do pedido, ou null quando não há o que dizer (nunca pediu,
 * ou o pedido mais recente já encerrou). Só afirma o que o servidor confirmou.
 */
export function helpNotice({ helpRequest, sending, failed }: HelpNoticeInput): HelpNotice | null {
  if (sending) return { variant: 'info', title: HELP_COPY.sending, retry: false };
  if (failed) return { variant: 'error', title: HELP_COPY.failed, retry: true };
  if (helpRequest === null || helpRequest.status === 'CLOSED') return null;
  if (helpRequest.status === 'OPEN') return { variant: 'success', title: HELP_COPY.sent, retry: false };
  const rescue = helpRequest.rescue?.status;
  const title =
    rescue === 'dispatched'
      ? HELP_COPY.rescuerOnTheWay
      : rescue === 'arrived'
        ? HELP_COPY.rescuerArrived
        : HELP_COPY.attended;
  return { variant: 'success', title, retry: false };
}
