// A fila única do app, montada com as peças reais. O que este teste cobre é a
// fiação: a chave do envio é um UUID v4 de verdade, cada tipo de item chega ao
// backend certo, e o arquivo só existe no aparelho com servidor de verdade.

const mockChat = {
  uploadImage: jest.fn(async (uri: string) => `chat-key:${uri}`),
  sendMessage: jest.fn(async () => ({ id: 'm-servidor' })),
};
const mockReports = {
  uploadImage: jest.fn(async (uri: string) => `reports-key:${uri}`),
  create: jest.fn(async () => ({ id: 'r-servidor' })),
  addComment: jest.fn(async () => ({ id: 'c-servidor' })),
};
jest.mock('../chat/getChatBackend', () => ({ getChatBackend: () => mockChat }));
jest.mock('../reports/getReportsBackend', () => ({ getReportsBackend: () => mockReports }));

// Disco de mentira: uri → conteúdo (texto do arquivo da fila, ou os bytes da foto).
const mockDisk = new Map<string, string>();
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    get size() {
      return mockDisk.get(this.uri)?.length ?? 0;
    }
    create() {
      mockDisk.set(this.uri, '');
    }
    write(text: string) {
      mockDisk.set(this.uri, text);
    }
    async text() {
      return mockDisk.get(this.uri) ?? '';
    }
    copy(destination: { uri: string }) {
      mockDisk.set(destination.uri, mockDisk.get(this.uri) ?? '');
    }
    delete() {
      mockDisk.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    exists = true;
    create() {}
    list() {
      return [...mockDisk.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`))
        .map((uri) => new File(uri));
    }
  }
  return { File, Directory, Paths: { document: 'file:///doc' } };
});

let mockBackendKind: 'api' | 'mock' = 'api';
jest.mock('../../lib/featureFlags', () => ({
  get DATA_BACKEND() {
    return mockBackendKind;
  },
}));

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARQUIVO_DA_FILA = 'file:///doc/send-outbox.v1.json';

// Cada teste monta a fila do zero: o módulo guarda a instância.
function novaFila() {
  let getSendQueue!: typeof import('./getSendQueue').getSendQueue;
  jest.isolateModules(() => {
    ({ getSendQueue } = require('./getSendQueue'));
  });
  return getSendQueue;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDisk.clear();
  mockBackendKind = 'api';
});

describe('getSendQueue', () => {
  it('é uma fila só para o app inteiro', () => {
    const getSendQueue = novaFila();

    expect(getSendQueue()).toBe(getSendQueue());
  });

  it('a mensagem sai pelo chat com um UUID v4 como chave do envio', async () => {
    const queue = novaFila()();
    await queue.start('u1');

    await queue.enqueue({ kind: 'chat.message', conversationId: 'a#b', body: 'oi' });
    await queue.kick();

    expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
    const [conversa, corpo, opts] = mockChat.sendMessage.mock.calls[0] as unknown as [
      string,
      string,
      { idempotencyKey: string },
    ];
    expect([conversa, corpo]).toEqual(['a#b', 'oi']);
    expect(opts.idempotencyKey).toMatch(UUID_V4);
  });

  it('relatório e comentário saem pelo backend de relatórios, cada um com a sua chave', async () => {
    const queue = novaFila()();
    await queue.start('u1');

    await queue.enqueue({
      kind: 'report', title: 'T', summary: 'S', details: 'D', responsibles: [], imageUris: [],
    });
    await queue.enqueue({ kind: 'report.comment', reportId: 'r1', body: 'oi' });
    await queue.kick();

    const chaveDoRelatorio = (mockReports.create.mock.calls[0] as unknown[])[1];
    const chaveDoComentario = (mockReports.addComment.mock.calls[0] as unknown[])[2];
    expect(chaveDoRelatorio).toMatch(UUID_V4);
    expect(chaveDoComentario).toMatch(UUID_V4);
    expect(chaveDoComentario).not.toBe(chaveDoRelatorio);
  });

  describe('no aparelho, com servidor de verdade', () => {
    it('a fila fica em arquivo e sobrevive ao reinício', async () => {
      mockChat.sendMessage.mockRejectedValueOnce(new TypeError('Network request failed'));
      const antes = novaFila()();
      await antes.start('u1');
      await antes.enqueue({ kind: 'chat.message', conversationId: 'a#b', body: 'ficou' });
      await antes.kick();

      expect(JSON.parse(mockDisk.get(ARQUIVO_DA_FILA) ?? '{}').items).toHaveLength(1);

      const depois = novaFila()();
      await depois.start('u1');
      await depois.kick();

      expect(mockChat.sendMessage).toHaveBeenCalledTimes(2);
      expect(JSON.parse(mockDisk.get(ARQUIVO_DA_FILA) ?? '{}').items).toEqual([]);
    });

    it('a foto é copiada para a pasta da fila, sobe pela cópia e a cópia sai depois', async () => {
      mockDisk.set('file:///cache/foto.jpg', 'bytes');
      const queue = novaFila()();
      await queue.start('u1');

      await queue.enqueue({
        kind: 'chat.message', conversationId: 'a#b', body: '', imageUri: 'file:///cache/foto.jpg',
      });
      await queue.kick();

      const [copia] = mockChat.uploadImage.mock.calls[0];
      expect(copia).toMatch(/^file:\/\/\/doc\/send-outbox\/.+\.jpg$/);
      expect(mockDisk.has(copia)).toBe(false);
      expect(mockDisk.has('file:///cache/foto.jpg')).toBe(true);
    });
  });

  // Sem servidor, a foto "enviada" é a própria uri local: copiar e apagar
  // deixaria o relatório de demonstração sem imagem.
  describe('no modo de demonstração', () => {
    it('não grava arquivo e manda a foto pela uri original', async () => {
      mockBackendKind = 'mock';
      mockDisk.set('file:///cache/foto.jpg', 'bytes');
      const queue = novaFila()();
      await queue.start('u1');

      await queue.enqueue({
        kind: 'chat.message', conversationId: 'a#b', body: '', imageUri: 'file:///cache/foto.jpg',
      });
      await queue.kick();

      expect(mockChat.uploadImage).toHaveBeenCalledWith('file:///cache/foto.jpg');
      expect([...mockDisk.keys()]).toEqual(['file:///cache/foto.jpg']);
    });
  });
});
