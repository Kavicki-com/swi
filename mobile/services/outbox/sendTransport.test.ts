import { createSendTransport } from './sendTransport';
import type { SendItem } from './sendOutbox';
import type { Message } from '../chat/types';
import type { Report, ReportComment } from '../reports/types';
import type { JourneySession, Task } from '../journey/types';

const base = { createdAt: '2026-10-04T12:00:00.000Z' };

const SESSAO: JourneySession = { state: 'ongoing', activeTaskId: 't1', startedAt: base.createdAt, accumulatedSeconds: 0 };
const TAREFA = { id: 't1' } as Task;

function backends() {
  const chat = {
    uploadImage: jest.fn(async (uri: string) => `chat:${uri}`),
    sendMessage: jest.fn(async () => ({ id: 'm-servidor' }) as Message),
  };
  const reports = {
    uploadImage: jest.fn(async (uri: string) => `reports:${uri}`),
    create: jest.fn(async () => ({ id: 'r-servidor' }) as Report),
    addComment: jest.fn(async () => ({ id: 'c-servidor' }) as ReportComment),
  };
  const journey = {
    uploadImage: jest.fn(async (uri: string) => `task:${uri}`),
    addTaskPhoto: jest.fn(async () => TAREFA),
    startTask: jest.fn(async () => ({ journey: SESSAO, task: TAREFA })),
    completeTask: jest.fn(async () => ({ journey: SESSAO, task: TAREFA })),
    cancelTask: jest.fn(async () => ({ journey: SESSAO, task: TAREFA })),
    pauseJourney: jest.fn(async () => SESSAO),
    resumeJourney: jest.fn(async () => SESSAO),
    endJourney: jest.fn(async () => SESSAO),
  };
  return { chat, reports, journey, transport: createSendTransport({ chat, reports, journey }) };
}

const acaoDaTarefa = (kind: 'journey.task.start' | 'journey.task.complete' | 'journey.task.cancel'): SendItem => ({
  ...base, id: 'k4', kind, taskId: 't1', taskTitle: 'Inspeção', images: [],
});
const acaoDoTurno = (kind: 'journey.pause' | 'journey.resume' | 'journey.end'): SendItem => ({
  ...base, id: 'k5', kind, images: [],
});

describe('createSendTransport', () => {
  it('mensagem: POST na conversa, com a chave do envio e sem anexo', async () => {
    const { chat, transport } = backends();
    const item: SendItem = {
      ...base, id: 'k1', kind: 'chat.message', conversationId: 'a#b', body: 'oi', images: [],
    };

    await expect(transport.send(item)).resolves.toEqual({ id: 'm-servidor' });

    expect(chat.sendMessage).toHaveBeenCalledWith('a#b', 'oi', {
      imageKey: undefined,
      idempotencyKey: 'k1',
    });
  });

  it('mensagem com anexo leva a key da foto já subida', async () => {
    const { chat, transport } = backends();
    const item: SendItem = {
      ...base, id: 'k1', kind: 'chat.message', conversationId: 'a#b', body: '',
      images: [{ localUri: 'file:///a.jpg', key: 'chat/a.jpg' }],
    };

    await transport.send(item);

    expect(chat.sendMessage).toHaveBeenCalledWith('a#b', '', {
      imageKey: 'chat/a.jpg',
      idempotencyKey: 'k1',
    });
  });

  it('relatório: as keys das fotos na ordem e a chave do envio', async () => {
    const { reports, transport } = backends();
    const item: SendItem = {
      ...base, id: 'k2', kind: 'report', title: 'T', summary: 'S', details: 'D',
      responsibles: ['Ana'],
      images: [
        { localUri: 'file:///a.jpg', key: 'reports/a.jpg' },
        { localUri: 'file:///b.jpg', key: 'reports/b.jpg' },
      ],
    };

    await expect(transport.send(item)).resolves.toEqual({ id: 'r-servidor' });

    expect(reports.create).toHaveBeenCalledWith(
      { title: 'T', summary: 'S', details: 'D', responsibles: ['Ana'], imageKeys: ['reports/a.jpg', 'reports/b.jpg'] },
      'k2',
    );
  });

  // Foto sem key no POST seria um relatório gravado sem a foto, e a chave do
  // envio impediria consertar depois. Melhor falhar e tentar de novo.
  it('relatório com foto ainda sem key não é enviado', async () => {
    const { reports, transport } = backends();
    const item: SendItem = {
      ...base, id: 'k2', kind: 'report', title: 'T', summary: 'S', details: 'D', responsibles: [],
      images: [{ localUri: 'file:///a.jpg', key: null }],
    };

    await expect(transport.send(item)).rejects.toThrow();
    expect(reports.create).not.toHaveBeenCalled();
  });

  // Uma página de manutenção ou um proxy podem responder 200 sem ser a API. O
  // apiRequest devolve {} para corpo que não é JSON; tratar isso como
  // confirmado tiraria da fila um envio que o servidor nunca recebeu.
  it.each([
    ['corpo vazio', {}],
    ['sem id', { title: 'T' }],
    ['id vazio', { id: '' }],
    ['nada', undefined],
  ])('resposta 2xx sem o registro criado (%s) não conta como envio: espera', async (_nome, resposta) => {
    const { chat, reports, transport } = backends();
    chat.sendMessage.mockResolvedValueOnce(resposta as Message);
    reports.create.mockResolvedValueOnce(resposta as Report);
    reports.addComment.mockResolvedValueOnce(resposta as ReportComment);
    const mensagem: SendItem = {
      ...base, id: 'k1', kind: 'chat.message', conversationId: 'a#b', body: 'oi', images: [],
    };
    const relatorio: SendItem = {
      ...base, id: 'k2', kind: 'report', title: 'T', summary: '', details: '', responsibles: [], images: [],
    };
    const comentario: SendItem = {
      ...base, id: 'k3', kind: 'report.comment', reportId: 'r1', body: 'oi', images: [],
    };

    for (const item of [mensagem, relatorio, comentario]) {
      const erro = await transport.send(item).then(
        () => null,
        (e: unknown) => e,
      );
      expect(erro).toBeInstanceOf(Error);
      // Sem `status`: a fila classifica como passageiro e tenta de novo.
      expect((erro as { status?: unknown }).status).toBeUndefined();
    }
  });

  it('comentário: POST no relatório com a chave do envio', async () => {
    const { reports, transport } = backends();
    const item: SendItem = {
      ...base, id: 'k3', kind: 'report.comment', reportId: 'r1', body: 'oi', images: [],
    };

    await expect(transport.send(item)).resolves.toEqual({ id: 'c-servidor' });

    expect(reports.addComment).toHaveBeenCalledWith('r1', 'oi', 'k3');
  });

  // A hora do toque vai como `occurredAt`, com o texto gravado no item: igual
  // em toda tentativa, que é o que o servidor compara.
  it.each([
    ['journey.task.start', 'startTask'],
    ['journey.task.complete', 'completeTask'],
    ['journey.task.cancel', 'cancelTask'],
  ] as const)('%s: POST da tarefa com a chave e a hora do toque', async (kind, metodo) => {
    const { journey, transport } = backends();

    await expect(transport.send(acaoDaTarefa(kind))).resolves.toEqual({ journey: SESSAO, task: TAREFA });

    expect(journey[metodo]).toHaveBeenCalledWith('t1', {
      idempotencyKey: 'k4',
      occurredAt: '2026-10-04T12:00:00.000Z',
    });
  });

  it.each([
    ['journey.pause', 'pauseJourney'],
    ['journey.resume', 'resumeJourney'],
    ['journey.end', 'endJourney'],
  ] as const)('%s: POST do turno com a chave e a hora do toque', async (kind, metodo) => {
    const { journey, transport } = backends();

    await expect(transport.send(acaoDoTurno(kind))).resolves.toEqual(SESSAO);

    expect(journey[metodo]).toHaveBeenCalledWith({
      idempotencyKey: 'k5',
      occurredAt: '2026-10-04T12:00:00.000Z',
    });
  });

  it('foto da tarefa: POST da key já subida', async () => {
    const { journey, transport } = backends();
    const item: SendItem = {
      ...base, id: 'k6', kind: 'journey.task.photo', taskId: 't1', taskTitle: 'Inspeção',
      images: [{ localUri: 'file:///f.jpg', key: 'task/f.jpg' }],
    };

    await expect(transport.send(item)).resolves.toEqual(TAREFA);

    expect(journey.addTaskPhoto).toHaveBeenCalledWith('t1', 'task/f.jpg');
  });

  it('foto da tarefa ainda sem key não é enviada', async () => {
    const { journey, transport } = backends();
    const item: SendItem = {
      ...base, id: 'k6', kind: 'journey.task.photo', taskId: 't1', taskTitle: 'Inspeção',
      images: [{ localUri: 'file:///f.jpg', key: null }],
    };

    await expect(transport.send(item)).rejects.toThrow();
    expect(journey.addTaskPhoto).not.toHaveBeenCalled();
  });

  // A resposta das ações não tem `id` na raiz: a da tarefa traz `{ journey,
  // task }`, a do turno traz o estado. Um 200 que não é da API continua
  // contando como falha passageira.
  it.each([
    ['corpo vazio', {}],
    ['sem a tarefa', { journey: SESSAO }],
    ['tarefa sem id', { journey: SESSAO, task: {} }],
    ['sem a jornada', { task: TAREFA }],
    ['nada', undefined],
  ])('ação da tarefa com resposta sem a tarefa e a jornada (%s): espera', async (_nome, resposta) => {
    const { journey, transport } = backends();
    journey.startTask.mockResolvedValueOnce(resposta as never);

    const erro = await transport.send(acaoDaTarefa('journey.task.start')).then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(Error);
    expect((erro as { status?: unknown }).status).toBeUndefined();
  });

  it.each([
    ['corpo vazio', {}],
    ['estado desconhecido', { state: 'outro' }],
    ['nada', undefined],
  ])('ação do turno com resposta sem o estado (%s): espera', async (_nome, resposta) => {
    const { journey, transport } = backends();
    journey.pauseJourney.mockResolvedValueOnce(resposta as never);

    const erro = await transport.send(acaoDoTurno('journey.pause')).then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(Error);
    expect((erro as { status?: unknown }).status).toBeUndefined();
  });

  it('a foto da tarefa sobe pelo backend da jornada', async () => {
    const { journey, transport } = backends();
    const item: SendItem = {
      ...base, id: 'k6', kind: 'journey.task.photo', taskId: 't1', taskTitle: 'Inspeção',
      images: [{ localUri: 'file:///f.jpg', key: null }],
    };

    await expect(transport.upload(item, 'file:///f.jpg')).resolves.toBe('task:file:///f.jpg');
    expect(journey.uploadImage).toHaveBeenCalledTimes(1);
  });

  it('a foto sobe pelo backend do tipo do item (o prefixo da key depende dele)', async () => {
    const { chat, reports, transport } = backends();
    const mensagem: SendItem = {
      ...base, id: 'k1', kind: 'chat.message', conversationId: 'a#b', body: '', images: [],
    };
    const relatorio: SendItem = {
      ...base, id: 'k2', kind: 'report', title: 'T', summary: '', details: '', responsibles: [], images: [],
    };

    await expect(transport.upload(mensagem, 'file:///a.jpg')).resolves.toBe('chat:file:///a.jpg');
    await expect(transport.upload(relatorio, 'file:///b.jpg')).resolves.toBe('reports:file:///b.jpg');

    expect(chat.uploadImage).toHaveBeenCalledTimes(1);
    expect(reports.uploadImage).toHaveBeenCalledTimes(1);
  });
});
