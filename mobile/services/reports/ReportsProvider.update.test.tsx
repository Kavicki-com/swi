import { act, create } from 'react-test-renderer';
import { ReportsProvider, useReports } from './ReportsProvider';
import type { Report } from './types';
import { createSendQueue, type SendQueue } from '../outbox/sendQueue';
import { createMemorySendStorage, createSendOutbox } from '../outbox/sendOutbox';
import { passthroughSendFiles } from '../outbox/sendFiles';
import { createSendTransport } from '../outbox/sendTransport';

// "Revisar relatório": a edição vai direto ao servidor, sem a fila de envios.
// Os anexos novos sobem antes; os que já estavam no servidor seguem pela key.
// Confirmado, o relatório novo entra na lista no lugar do antigo e o detalhe
// sabe que precisa reler (`revision`).

const doServidor = (id: string, title: string): Report => ({
  id,
  title,
  summary: 'Resumo',
  status: 'pending',
  statusLabel: 'Em Revisão',
  authorName: 'Josué Oliveira',
  authorAvatarUri: '',
  creationDate: '04/10/2026',
  sector: 'Setor Leste',
  responsibles: ['Ana'],
  details: 'Detalhes',
  images: [],
  attachments: [],
  activities: [],
  comments: [],
});

const KEY_A = 'reports/11111111-1111-1111-1111-111111111111.jpg';
const KEY_B = 'reports/22222222-2222-2222-2222-222222222222.pdf';

const mockBackend = {
  list: jest.fn(async (): Promise<Report[]> => []),
  get: jest.fn(async (): Promise<Report | null> => null),
  uploadImage: jest.fn(async (uri: string) => `key:${uri}`),
  create: jest.fn(),
  addComment: jest.fn(),
  update: jest.fn(),
};
jest.mock('./getReportsBackend', () => ({ getReportsBackend: () => mockBackend }));

let mockQueue: SendQueue;
jest.mock('../outbox/getSendQueue', () => ({ getSendQueue: () => mockQueue }));
jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'josue@example.test', name: 'Josué Oliveira' } }),
}));
jest.mock('../realtime/connectionStatus', () => ({
  connectionStatus: { onReconnect: () => () => undefined },
}));
jest.mock('../profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: null }),
}));

let reports!: ReturnType<typeof useReports>;
function Sonda() {
  reports = useReports();
  return null;
}

let montada: ReturnType<typeof create> | null = null;
afterEach(() => {
  act(() => montada?.unmount());
  montada = null;
});

async function montar() {
  await act(async () => {
    montada = create(
      <ReportsProvider>
        <Sonda />
      </ReportsProvider>,
    );
  });
}

const edicao = {
  title: 'Inspeção revisada',
  summary: 'Resumo novo',
  details: 'Detalhes novos',
  responsibles: ['Ana', 'Bruno'],
  attachments: [{ key: KEY_A, uri: 'https://signed.example.test/a.jpg' }, { uri: 'file:///tmp/nova.jpg' }],
  baseKeys: [KEY_A, KEY_B],
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockBackend.list.mockResolvedValue([doServidor('r1', 'Inspeção'), doServidor('r2', 'Vazamento')]);
  mockBackend.update.mockImplementation(async (id: string, p: { title: string }) =>
    doServidor(id, p.title),
  );
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
    now: () => 0,
    newId: () => 'chave',
  });
  await mockQueue.start('u1');
});

describe('ReportsProvider: editar relatório', () => {
  it('sobe só o anexo novo e manda as keys que ficam e as que o formulário carregou', async () => {
    await montar();

    await act(async () => {
      await reports.update('r1', edicao);
    });

    expect(mockBackend.uploadImage).toHaveBeenCalledTimes(1);
    expect(mockBackend.uploadImage).toHaveBeenCalledWith('file:///tmp/nova.jpg');
    expect(mockBackend.update).toHaveBeenCalledWith('r1', {
      title: 'Inspeção revisada',
      summary: 'Resumo novo',
      details: 'Detalhes novos',
      responsibles: ['Ana', 'Bruno'],
      imageKeys: [KEY_A, 'key:file:///tmp/nova.jpg'],
      imageKeysBase: [KEY_A, KEY_B],
    });
  });

  it('confirmado, o relatório novo fica no lugar do antigo na lista e a revisão avança', async () => {
    await montar();
    await act(async () => {
      await reports.load();
    });
    const antes = reports.revision;

    let devolvido: Report | undefined;
    await act(async () => {
      devolvido = await reports.update('r1', edicao);
    });

    expect(devolvido?.title).toBe('Inspeção revisada');
    expect(reports.reports.map((r) => r.title)).toEqual(['Inspeção revisada', 'Vazamento']);
    expect(reports.revision).toBe(antes + 1);
  });

  it('falha do servidor propaga e deixa a lista e a revisão como estavam', async () => {
    mockBackend.update.mockRejectedValue(new Error('HTTP 500'));
    await montar();
    await act(async () => {
      await reports.load();
    });
    const antes = reports.revision;

    let erro: unknown;
    await act(async () => {
      await reports.update('r1', edicao).catch((e) => {
        erro = e;
      });
    });

    expect(erro).toBeInstanceOf(Error);
    expect(reports.reports.map((r) => r.title)).toEqual(['Inspeção', 'Vazamento']);
    expect(reports.revision).toBe(antes);
  });
});
