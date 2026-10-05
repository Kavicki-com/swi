import {
  OFFLINE_PENDING_TITLE,
  OFFLINE_TITLE,
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

  it('aviso de sem conexão com envio esperando o sinal', () => {
    expect(OFFLINE_PENDING_TITLE).toBe('Sem conexão. Suas ações serão enviadas quando o sinal voltar.');
  });

  it('aviso de sem conexão sem envio esperando', () => {
    expect(OFFLINE_TITLE).toBe('Sem conexão. As informações na tela podem estar desatualizadas.');
  });

  it('título da recusa de uma ação da jornada diz o que não valeu', () => {
    const tarefa = { ...base, taskId: 't1', taskTitle: 'Inspeção de Equipamentos' };
    const titulos = [
      refusalTitle({ ...tarefa, kind: 'journey.task.start' }),
      refusalTitle({ ...tarefa, kind: 'journey.task.complete' }),
      refusalTitle({ ...tarefa, kind: 'journey.task.cancel' }),
      refusalTitle({ ...base, kind: 'journey.pause' }),
      refusalTitle({ ...base, kind: 'journey.resume' }),
      refusalTitle({ ...base, kind: 'journey.end' }),
      refusalTitle({ ...tarefa, kind: 'journey.task.photo' }),
    ];

    expect(titulos).toEqual([
      'Não foi possível iniciar a tarefa "Inspeção de Equipamentos".',
      'Não foi possível finalizar a tarefa "Inspeção de Equipamentos".',
      'Não foi possível cancelar a tarefa "Inspeção de Equipamentos".',
      'Não foi possível pausar a jornada.',
      'Não foi possível retomar a jornada.',
      'Não foi possível finalizar a jornada.',
      'Não foi possível enviar a foto da tarefa "Inspeção de Equipamentos".',
    ]);
  });

  it('a mensagem da recusa diz o motivo', () => {
    expect(refusalMessage('rejected')).toBe('O servidor recusou o envio.');
    expect(refusalMessage('expired')).toBe('O envio expirou depois de 3 dias sem conexão.');
  });
});
