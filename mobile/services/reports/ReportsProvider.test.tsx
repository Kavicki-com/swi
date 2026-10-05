import { act, create } from 'react-test-renderer';
import { ReportsProvider, useReports } from './ReportsProvider';
import type { Report, ReportComment, ReportInput } from './types';
import { createSendQueue, type SendQueue } from '../outbox/sendQueue';
import { createMemorySendStorage, createSendOutbox, MAX_QUEUED_SENDS } from '../outbox/sendOutbox';
import { passthroughSendFiles } from '../outbox/sendFiles';
import { createSendTransport } from '../outbox/sendTransport';

// Os relatórios em cima da fila de envios. A fila aqui é a real, com disco em
// memória e o backend de relatórios de mentira: o que se testa é o que a
// pessoa vê (cartão pendente, relatório uma vez só, comentário aguardando).

const doServidor = (id: string, title: string): Report => ({
  id,
  title,
  summary: 'Resumo',
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Josué Oliveira',
  authorAvatarUri: 'signed:josue',
  creationDate: '04/10/2026',
  sector: 'Setor Leste',
  responsibles: ['Ana'],
  details: 'Detalhes',
  images: [],
  activities: [],
  comments: [],
});

const comentarioDoServidor = (id: string, body: string): ReportComment => ({
  id,
  body,
  authorName: 'Josué Oliveira',
  authorAvatarUri: 'signed:josue',
  createdAt: '04/10/2026',
});

const mockBackend = {
  list: jest.fn(async (): Promise<Report[]> => []),
  get: jest.fn(async (): Promise<Report | null> => null),
  uploadImage: jest.fn(async (uri: string) => `key:${uri}`),
  create: jest.fn(),
  addComment: jest.fn(),
};
jest.mock('./getReportsBackend', () => ({ getReportsBackend: () => mockBackend }));

let mockQueue: SendQueue;
jest.mock('../outbox/getSendQueue', () => ({ getSendQueue: () => mockQueue }));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'josue@example.test', name: 'Josué Oliveira' } }),
}));
let mockProfile: { avatarUrl?: string; sector?: string } | null = null;
jest.mock('../profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: mockProfile }),
}));

const comStatus = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status, apiError: true });
const semRede = () => new TypeError('Network request failed');

const entrada = (over: Partial<ReportInput> = {}): ReportInput => ({
  title: 'Inspeção das máquinas',
  summary: 'Checklist',
  details: 'Tudo conferido.',
  responsibles: ['Ana'],
  imageUris: [],
  ...over,
});

let reports!: ReturnType<typeof useReports>;
function Sonda() {
  reports = useReports();
  return null;
}

async function montar() {
  await act(async () => {
    create(
      <ReportsProvider>
        <Sonda />
      </ReportsProvider>,
    );
  });
}

/** Deixa a rodada de envio em andamento terminar e o React assentar. */
const assentar = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** A próxima tentativa da fila (o relógio de 15 s, ou a volta ao primeiro plano). */
const tentarDeNovo = () =>
  act(async () => {
    await mockQueue.kick();
  });

const AGORA = new Date(2026, 9, 4, 12, 0, 0);

beforeEach(async () => {
  jest.clearAllMocks();
  mockProfile = { avatarUrl: 'signed:eu', sector: 'Setor Leste' };
  let n = 0;
  mockBackend.create.mockImplementation(async (payload: { title: string }) =>
    doServidor(`srv-${(n += 1)}`, payload.title),
  );
  mockBackend.addComment.mockImplementation(async (_id: string, body: string) =>
    comentarioDoServidor(`c-srv-${(n += 1)}`, body),
  );
  let id = 0;
  mockQueue = createSendQueue({
    outbox: createSendOutbox(createMemorySendStorage()),
    files: passthroughSendFiles,
    transport: createSendTransport({
      chat: { uploadImage: jest.fn(), sendMessage: jest.fn() },
      reports: mockBackend,
      journey: {
        uploadImage: jest.fn(), addTaskPhoto: jest.fn(), startTask: jest.fn(), completeTask: jest.fn(),
        cancelTask: jest.fn(), pauseJourney: jest.fn(), resumeJourney: jest.fn(), endJourney: jest.fn(),
      },
    }),
    now: () => AGORA.getTime(),
    newId: () => `chave-${(id += 1)}`,
  });
  await mockQueue.start('u1');
});

describe('ReportsProvider: novo relatório pela fila', () => {
  it('o relatório aparece na hora como cartão pendente, antes de o servidor responder', async () => {
    mockBackend.create.mockReturnValue(new Promise(() => {}));
    await montar();

    let resultado: string | undefined;
    await act(async () => {
      resultado = await reports.create(entrada());
    });

    expect(resultado).toBe('queued');
    expect(reports.reports).toEqual([]);
    expect(reports.pendingReports).toEqual([
      {
        id: 'chave-1',
        title: 'Inspeção das máquinas',
        summary: 'Checklist',
        status: 'pending',
        statusLabel: 'Aguardando envio',
        authorName: 'Josué Oliveira',
        authorAvatarUri: 'signed:eu',
        creationDate: '04/10/2026',
        sector: 'Setor Leste',
        responsibles: ['Ana'],
        details: 'Tudo conferido.',
        images: [],
        activities: [],
        comments: [],
      },
    ]);
  });

  it('sem perfil carregado o cartão pendente sai sem foto e sem setor, mas sai', async () => {
    mockProfile = null;
    mockBackend.create.mockReturnValue(new Promise(() => {}));
    await montar();

    await act(async () => {
      await reports.create(entrada());
    });

    expect(reports.pendingReports[0]).toMatchObject({ authorAvatarUri: '', sector: '' });
  });

  it('confirmado pelo servidor: o pendente some e o relatório do servidor entra no topo', async () => {
    mockBackend.list.mockResolvedValueOnce([doServidor('r-antigo', 'Antigo')]);
    await montar();
    await act(async () => {
      await reports.load();
    });

    await act(async () => {
      await reports.create(entrada());
    });
    await assentar();

    expect(reports.pendingReports).toEqual([]);
    expect(reports.reports.map((r) => r.id)).toEqual(['srv-1', 'r-antigo']);
    expect(mockBackend.create).toHaveBeenCalledWith(
      {
        title: 'Inspeção das máquinas',
        summary: 'Checklist',
        details: 'Tudo conferido.',
        responsibles: ['Ana'],
        imageKeys: [],
      },
      'chave-1',
    );
  });

  // A lista estava vazia: o primeiro relatório confirmado tira a tela do
  // estado "nenhum relatório".
  it('o primeiro relatório confirmado tira a lista do estado vazio', async () => {
    await montar();
    await act(async () => {
      await reports.load();
    });
    expect(reports.status).toBe('empty');

    await act(async () => {
      await reports.create(entrada());
    });
    await assentar();

    expect(reports.status).toBe('ready');
  });

  it('as fotos sobem uma a uma e o relatório leva as keys, na ordem', async () => {
    await montar();

    await act(async () => {
      await reports.create(entrada({ imageUris: ['file:///a.jpg', 'file:///b.jpg'] }));
    });
    await assentar();

    expect(mockBackend.uploadImage.mock.calls.map(([uri]) => uri)).toEqual([
      'file:///a.jpg',
      'file:///b.jpg',
    ]);
    expect(mockBackend.create.mock.calls[0][0].imageKeys).toEqual([
      'key:file:///a.jpg',
      'key:file:///b.jpg',
    ]);
  });

  it('sem rede: fica pendente e sai na próxima tentativa, com a mesma chave', async () => {
    mockBackend.create.mockRejectedValueOnce(semRede());
    await montar();

    await act(async () => {
      await reports.create(entrada());
    });
    await assentar();
    expect(reports.pendingReports).toHaveLength(1);

    await tentarDeNovo();

    expect(reports.pendingReports).toEqual([]);
    expect(reports.reports.map((r) => r.id)).toEqual(['srv-1']);
    expect(mockBackend.create.mock.calls.map(([, chave]) => chave)).toEqual(['chave-1', 'chave-1']);
  });

  it('recusado pelo servidor: o cartão pendente sai e nada entra na lista', async () => {
    mockBackend.create.mockRejectedValueOnce(comStatus(403));
    await montar();

    await act(async () => {
      await reports.create(entrada());
    });
    await assentar();

    expect(reports.pendingReports).toEqual([]);
    expect(reports.reports).toEqual([]);
  });

  it('o pendente mais novo fica no topo, como na lista', async () => {
    mockBackend.create.mockReturnValue(new Promise(() => {}));
    await montar();

    await act(async () => {
      await reports.create(entrada({ title: 'Primeiro' }));
      await reports.create(entrada({ title: 'Segundo' }));
    });

    expect(reports.pendingReports.map((r) => r.title)).toEqual(['Segundo', 'Primeiro']);
  });

  // A lista foi recarregada entre o envio e a confirmação e já trouxe o
  // relatório: ele não entra duas vezes.
  it('relatório que a lista já trouxe não entra de novo', async () => {
    let responder!: (r: Report) => void;
    mockBackend.create.mockReturnValueOnce(new Promise<Report>((r) => (responder = r)));
    mockBackend.list.mockResolvedValueOnce([doServidor('srv-9', 'Inspeção das máquinas')]);
    await montar();
    await act(async () => {
      await reports.create(entrada());
    });
    await act(async () => {
      await reports.load();
    });

    await act(async () => {
      responder(doServidor('srv-9', 'Inspeção das máquinas'));
    });
    await assentar();

    expect(reports.reports.map((r) => r.id)).toEqual(['srv-9']);
  });

  it('fila cheia: avisa quem chamou, e o relatório não entra', async () => {
    mockBackend.addComment.mockRejectedValue(semRede());
    await montar();
    await act(async () => {
      for (let i = 0; i < MAX_QUEUED_SENDS; i += 1) {
        await mockQueue.enqueue({ kind: 'report.comment', reportId: 'r1', body: `c${i}` });
      }
      await mockQueue.kick();
    });

    let resultado: string | undefined;
    await act(async () => {
      resultado = await reports.create(entrada());
    });

    expect(resultado).toBe('full');
    expect(reports.pendingReports).toEqual([]);
  });
});

describe('ReportsProvider: comentário pela fila', () => {
  it('o comentário aparece na hora como pendente, só no relatório dele', async () => {
    mockBackend.addComment.mockReturnValue(new Promise(() => {}));
    await montar();

    let resultado: string | undefined;
    await act(async () => {
      resultado = await reports.addComment('r1', 'Confirmado em campo.');
    });

    expect(resultado).toBe('queued');
    expect(reports.commentsFor('r1')).toEqual({
      sent: [],
      pending: [
        {
          id: 'chave-1',
          body: 'Confirmado em campo.',
          authorName: 'Josué Oliveira',
          authorAvatarUri: 'signed:eu',
          createdAt: 'Aguardando envio',
        },
      ],
    });
    expect(reports.commentsFor('r2')).toEqual({ sent: [], pending: [] });
  });

  it('confirmado: sai dos pendentes e fica como comentário do servidor', async () => {
    await montar();

    await act(async () => {
      await reports.addComment('r1', 'Confirmado em campo.');
    });
    await assentar();

    expect(reports.commentsFor('r1')).toEqual({
      sent: [comentarioDoServidor('c-srv-1', 'Confirmado em campo.')],
      pending: [],
    });
    expect(mockBackend.addComment).toHaveBeenCalledWith('r1', 'Confirmado em campo.', 'chave-1');
  });

  it('recusado pelo servidor: o comentário pendente sai', async () => {
    mockBackend.addComment.mockRejectedValueOnce(comStatus(404));
    await montar();

    await act(async () => {
      await reports.addComment('r1', 'Confirmado em campo.');
    });
    await assentar();

    expect(reports.commentsFor('r1')).toEqual({ sent: [], pending: [] });
  });
});

describe('ReportsProvider: leitura', () => {
  it('load com relatórios fica pronto; sem nenhum, vazio; com falha, erro', async () => {
    await montar();

    mockBackend.list.mockResolvedValueOnce([doServidor('r1', 'Um')]);
    await act(async () => {
      await reports.load();
    });
    expect(reports.status).toBe('ready');

    mockBackend.list.mockResolvedValueOnce([]);
    await act(async () => {
      await reports.load();
    });
    expect(reports.status).toBe('empty');

    mockBackend.list.mockRejectedValueOnce(semRede());
    await act(async () => {
      await reports.load();
    });
    expect(reports.status).toBe('error');
  });

  it('loadOne busca o relatório pelo id', async () => {
    mockBackend.get.mockResolvedValueOnce(doServidor('r1', 'Um'));
    await montar();

    await expect(reports.loadOne('r1')).resolves.toMatchObject({ id: 'r1' });
  });
});
