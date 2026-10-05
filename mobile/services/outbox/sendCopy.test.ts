import {
  PENDING_LABEL,
  QUEUE_FULL_TITLE,
  REFUSED_LABEL,
  refusalMessage,
  refusalTitle,
} from './sendCopy';
import type { SendItem } from './sendOutbox';

const base = { id: 'i1', createdAt: '2026-10-04T12:00:00.000Z', images: [] };

// Textos fora do Figma, aprovados à parte. O teste trava a redação: mudar
// aqui é mudar o que foi aprovado.
describe('textos da fila de envios', () => {
  it('rótulos do envio pendente e do recusado', () => {
    expect(PENDING_LABEL).toBe('Aguardando envio');
    expect(REFUSED_LABEL).toBe('Não enviada');
  });

  it('aviso de fila cheia', () => {
    expect(QUEUE_FULL_TITLE).toBe(
      'Há muitos envios aguardando conexão. Tente de novo quando o sinal voltar.',
    );
  });

  it('título da recusa nomeia o que não foi enviado', () => {
    const mensagem: SendItem = { ...base, kind: 'chat.message', conversationId: 'a#b', body: 'oi' };
    const relatorio: SendItem = {
      ...base,
      kind: 'report',
      title: 'Inspeção das máquinas',
      summary: '',
      details: '',
      responsibles: [],
    };
    const comentario: SendItem = { ...base, kind: 'report.comment', reportId: 'r1', body: 'oi' };

    expect(refusalTitle(mensagem)).toBe('Não foi possível enviar a mensagem.');
    expect(refusalTitle(relatorio)).toBe('Não foi possível enviar o relatório "Inspeção das máquinas".');
    expect(refusalTitle(comentario)).toBe('Não foi possível enviar o comentário.');
  });

  it('a mensagem da recusa diz o motivo', () => {
    expect(refusalMessage('rejected')).toBe('O servidor recusou o envio.');
    expect(refusalMessage('expired')).toBe('O envio expirou depois de 3 dias sem conexão.');
  });
});
