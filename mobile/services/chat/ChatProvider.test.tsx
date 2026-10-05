import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';
import { ChatProvider, useChat } from './ChatProvider';
import { connectionStatus } from '../realtime/connectionStatus';
import type { Conversation, Message } from './types';
import { createSendQueue, type SendQueue } from '../outbox/sendQueue';
import { createMemorySendStorage, createSendOutbox, MAX_QUEUED_SENDS } from '../outbox/sendOutbox';
import { passthroughSendFiles } from '../outbox/sendFiles';
import { createSendTransport } from '../outbox/sendTransport';

// O chat em cima da fila de envios. A fila aqui é a real, com disco em memória
// e o backend do chat de mentira: o que se testa é o que a pessoa vê (balão
// pendente, mensagem uma vez só, conversa que não cai).

const CONV = 'me#w1';

const conversa = (over: Partial<Conversation> = {}): Conversation => ({
  id: CONV,
  participants: ['me', 'w1'],
  participantNames: ['Eu', 'Ana'],
  participantSubtitles: ['', 'Setor Leste'],
  participantAvatars: ['', ''],
  lastMessageBody: 'antes',
  lastMessageAt: '2026-10-04T11:00:00.000Z',
  unreadBy: { me: 2 },
  ...over,
});

const doServidor = (id: string, body: string, senderId = 'me'): Message => ({
  id,
  conversationId: CONV,
  participants: ['me', 'w1'],
  senderId,
  body,
  imageUri: null,
  sentAt: '2026-10-04T12:00:00.000Z',
});

let socket: (msg: Message) => void = () => undefined;
const mockBackend = {
  myId: 'me',
  listConversations: jest.fn(async () => [conversa()]),
  listMessages: jest.fn(async (): Promise<Message[]> => []),
  listDirectory: jest.fn(async () => []),
  uploadImage: jest.fn(async (uri: string) => `key:${uri}`),
  sendMessage: jest.fn(),
  markRead: jest.fn(async () => undefined),
  subscribe: jest.fn((_conv: string | null, cb: (msg: Message) => void) => {
    socket = cb;
    return () => undefined;
  }),
};
jest.mock('./getChatBackend', () => ({ getChatBackend: () => mockBackend }));

let mockQueue: SendQueue;
jest.mock('../outbox/getSendQueue', () => ({ getSendQueue: () => mockQueue }));

const comStatus = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status, apiError: true });
const semRede = () => new TypeError('Network request failed');

let chat!: ReturnType<typeof useChat>;
function Sonda() {
  chat = useChat();
  return null;
}

// Toda árvore montada é desmontada ao fim do teste: uma árvore viva segue
// ouvindo a volta da conexão e trocaria o `chat` do teste seguinte.
const montadas: ReturnType<typeof create>[] = [];
async function montar() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <ChatProvider>
        <Sonda />
      </ChatProvider>,
    );
  });
  montadas.push(tree);
  return tree;
}

afterEach(() => {
  act(() => {
    for (const tree of montadas.splice(0)) tree.unmount();
  });
});

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

const corpos = () => chat.messagesFor(CONV).map((m) => m.body);
const pendentes = () => chat.outgoingFor(CONV).map((o) => [o.body, o.state]);

beforeEach(async () => {
  jest.clearAllMocks();
  let n = 0;
  mockBackend.sendMessage.mockImplementation(async (_conv: string, body: string) =>
    doServidor(`srv-${(n += 1)}`, body),
  );
  let id = 0;
  mockQueue = createSendQueue({
    outbox: createSendOutbox(createMemorySendStorage()),
    files: passthroughSendFiles,
    transport: createSendTransport({
      chat: mockBackend,
      reports: { uploadImage: jest.fn(), create: jest.fn(), addComment: jest.fn() },
      journey: {
        uploadImage: jest.fn(), addTaskPhoto: jest.fn(), startTask: jest.fn(), completeTask: jest.fn(),
        cancelTask: jest.fn(), pauseJourney: jest.fn(), resumeJourney: jest.fn(), endJourney: jest.fn(),
      },
    }),
    now: () => Date.parse('2026-10-04T12:00:00.000Z'),
    newId: () => `chave-${(id += 1)}`,
  });
  await mockQueue.start('me');
});

describe('ChatProvider: envio pela fila', () => {
  it('a mensagem aparece na hora como pendente, antes de o servidor responder', async () => {
    mockBackend.sendMessage.mockReturnValue(new Promise(() => {}));
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });

    let resultado: string | undefined;
    await act(async () => {
      resultado = await chat.send(CONV, 'bom dia');
    });

    expect(resultado).toBe('queued');
    expect(pendentes()).toEqual([['bom dia', 'pending']]);
    expect(corpos()).toEqual([]);
  });

  it('confirmada pelo servidor: o pendente some e a mensagem entra uma vez', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });

    await act(async () => {
      await chat.send(CONV, 'bom dia');
    });
    await assentar();

    expect(pendentes()).toEqual([]);
    expect(corpos()).toEqual(['bom dia']);
    expect(mockBackend.sendMessage).toHaveBeenCalledWith(CONV, 'bom dia', {
      imageKey: undefined,
      idempotencyKey: 'chave-1',
    });
  });

  // O servidor manda a mensagem pelo socket também a quem enviou. Sem tirar a
  // repetida, a pessoa veria a própria mensagem duas vezes.
  it('a resposta do envio e o eco do socket viram uma mensagem só', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });

    await act(async () => {
      await chat.send(CONV, 'bom dia');
    });
    await assentar();
    act(() => socket(doServidor('srv-1', 'bom dia')));

    expect(corpos()).toEqual(['bom dia']);
  });

  // O eco costuma chegar antes da resposta do POST. Nesse intervalo a mensagem
  // do servidor e o balão pendente não podem aparecer juntos.
  it('o eco que chega antes da resposta já tira o pendente da tela', async () => {
    let responder!: (m: Message) => void;
    mockBackend.sendMessage.mockReturnValueOnce(new Promise<Message>((r) => (responder = r)));
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });
    await act(async () => {
      await chat.send(CONV, 'bom dia');
    });

    act(() => socket(doServidor('srv-1', 'bom dia')));

    expect(corpos()).toEqual(['bom dia']);
    expect(pendentes()).toEqual([]);

    await act(async () => {
      responder(doServidor('srv-1', 'bom dia'));
    });
    await assentar();

    expect(corpos()).toEqual(['bom dia']);
    expect(pendentes()).toEqual([]);
  });

  // A resposta do POST se perdeu, mas a mensagem chegou ao servidor. O eco do
  // socket dispara o reenvio na hora, com a mesma chave, e o servidor devolve
  // a mesma mensagem.
  it('resposta perdida: o eco dispara o reenvio com a mesma chave, sem duplicar', async () => {
    mockBackend.sendMessage
      .mockRejectedValueOnce(semRede())
      .mockResolvedValueOnce(doServidor('srv-1', 'bom dia'));
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });
    await act(async () => {
      await chat.send(CONV, 'bom dia');
    });
    await assentar();
    expect(mockBackend.sendMessage).toHaveBeenCalledTimes(1);

    act(() => socket(doServidor('srv-1', 'bom dia')));
    await assentar();

    expect(mockBackend.sendMessage).toHaveBeenCalledTimes(2);
    const chaves = mockBackend.sendMessage.mock.calls.map(([, , opts]) => opts.idempotencyKey);
    expect(chaves).toEqual(['chave-1', 'chave-1']);
    expect(corpos()).toEqual(['bom dia']);
    expect(pendentes()).toEqual([]);
  });

  // A fila envia um item por vez: só o da frente pode ter um eco. Uma mensagem
  // minha com o mesmo texto, vinda de outro aparelho, não pode esconder o
  // balão de uma mensagem que ainda nem saiu.
  it('mensagem igual vinda de outro aparelho não esconde o pendente que ainda não saiu', async () => {
    mockBackend.sendMessage.mockReturnValue(new Promise(() => {}));
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });
    await act(async () => {
      await chat.send(CONV, 'um');
      await chat.send(CONV, 'dois');
    });

    act(() => socket(doServidor('de-outro-aparelho', 'dois')));

    expect(pendentes()).toEqual([
      ['um', 'pending'],
      ['dois', 'pending'],
    ]);
    expect(corpos()).toEqual(['dois']);
  });

  it('sem rede: a mensagem fica pendente e sai quando a fila tentar de novo', async () => {
    mockBackend.sendMessage.mockRejectedValueOnce(semRede());
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });

    await act(async () => {
      await chat.send(CONV, 'bom dia');
    });
    await assentar();
    expect(pendentes()).toEqual([['bom dia', 'pending']]);

    await tentarDeNovo();
    expect(pendentes()).toEqual([]);
    expect(corpos()).toEqual(['bom dia']);
  });

  it('recusada pelo servidor: o balão fica como não enviado', async () => {
    mockBackend.sendMessage.mockRejectedValueOnce(comStatus(403));
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });

    await act(async () => {
      await chat.send(CONV, 'bom dia');
    });
    await assentar();

    expect(pendentes()).toEqual([['bom dia', 'refused']]);
    expect(corpos()).toEqual([]);
  });

  it('o anexo vai junto, pela uri que a tela escolheu', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });

    await act(async () => {
      await chat.send(CONV, '', 'file:///foto.jpg');
    });
    await assentar();

    expect(mockBackend.uploadImage).toHaveBeenCalledWith('file:///foto.jpg');
    expect(mockBackend.sendMessage).toHaveBeenCalledWith(CONV, '', {
      imageKey: 'key:file:///foto.jpg',
      idempotencyKey: 'chave-1',
    });
  });

  it('os pendentes são da conversa certa', async () => {
    mockBackend.sendMessage.mockReturnValue(new Promise(() => {}));
    await montar();

    await act(async () => {
      await chat.send('me#w2', 'para outra pessoa');
    });

    expect(chat.outgoingFor(CONV)).toEqual([]);
    expect(chat.outgoingFor('me#w2').map((o) => o.body)).toEqual(['para outra pessoa']);
  });

  it('fila cheia: avisa quem chamou, e a mensagem não entra', async () => {
    mockBackend.sendMessage.mockRejectedValue(semRede());
    await montar();
    await act(async () => {
      for (let i = 0; i < MAX_QUEUED_SENDS; i += 1) {
        await mockQueue.enqueue({ kind: 'chat.message', conversationId: 'me#w2', body: `m${i}` });
      }
      await mockQueue.kick();
    });

    let resultado: string | undefined;
    await act(async () => {
      resultado = await chat.send(CONV, 'a mais');
    });

    expect(resultado).toBe('full');
    expect(pendentes()).toEqual([]);
  });
});

describe('ChatProvider: mensagens que chegam', () => {
  it('mensagem do contato entra na conversa aberta e atualiza o cartão', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });

    act(() => socket(doServidor('m9', 'tudo certo?', 'w1')));

    expect(corpos()).toEqual(['tudo certo?']);
    expect(chat.conversations[0].lastMessageBody).toBe('tudo certo?');
  });

  // O socket pode repetir a entrega depois de reconectar.
  it('a mesma mensagem entregue duas vezes entra uma vez', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });

    act(() => socket(doServidor('m9', 'tudo certo?', 'w1')));
    act(() => socket(doServidor('m9', 'tudo certo?', 'w1')));

    expect(corpos()).toEqual(['tudo certo?']);
  });

  // O backend avisa edição e exclusão pelo mesmo evento, com o mesmo id e o
  // estado atual da mensagem: ela troca no lugar, não entra de novo.
  it('mensagem editada troca no lugar e não conta como nova não lida', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });
    act(() => socket(doServidor('m9', 'tudo certo?', 'w1')));
    const cartao = chat.conversations[0];

    act(() => socket(doServidor('m9', 'tudo certo por aí?', 'w1')));

    expect(corpos()).toEqual(['tudo certo por aí?']);
    expect(chat.conversations[0]).toBe(cartao);
  });

  it('mensagem que já veio no histórico não entra de novo pelo socket', async () => {
    mockBackend.listMessages.mockResolvedValueOnce([doServidor('m1', 'do histórico', 'w1')]);
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });

    act(() => socket(doServidor('m1', 'do histórico', 'w1')));

    expect(corpos()).toEqual(['do histórico']);
  });
});

describe('ChatProvider: abrir a conversa', () => {
  it('carrega o histórico e zera o contador quando o "lida" passa', async () => {
    mockBackend.listMessages.mockResolvedValueOnce([doServidor('m1', 'oi', 'w1')]);
    await montar();

    await act(async () => {
      await chat.openConversation(CONV);
    });

    expect(corpos()).toEqual(['oi']);
    expect(mockBackend.markRead).toHaveBeenCalledWith(CONV);
    expect(chat.conversations[0].unreadBy.me).toBe(0);
  });

  // Antes, a falha do "marcar como lida" rejeitava o abrir inteiro e a tela
  // trocava a conversa já carregada por um erro.
  it('falha ao marcar como lida não derruba a conversa: só o contador fica como está', async () => {
    mockBackend.listMessages.mockResolvedValueOnce([doServidor('m1', 'oi', 'w1')]);
    mockBackend.markRead.mockRejectedValueOnce(semRede());
    await montar();

    await act(async () => {
      await expect(chat.openConversation(CONV)).resolves.toBeUndefined();
    });

    expect(corpos()).toEqual(['oi']);
    expect(chat.conversations[0].unreadBy.me).toBe(2);
  });

  it('falha ao carregar o histórico continua sendo erro de abrir', async () => {
    mockBackend.listMessages.mockRejectedValueOnce(semRede());
    await montar();

    await act(async () => {
      await expect(chat.openConversation(CONV)).rejects.toThrow();
    });
  });
});

describe('ChatProvider: fechar a conversa', () => {
  // Antes a conversa nunca fechava: de volta à lista, a mensagem nova da
  // última conversa aberta era marcada como lida sem ninguém ver.
  it('mensagem que chega depois de a tela sair da conversa conta como não lida', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });
    mockBackend.markRead.mockClear();

    act(() => chat.closeConversation(CONV));
    act(() => socket(doServidor('m9', 'tudo certo?', 'w1')));

    expect(mockBackend.markRead).not.toHaveBeenCalled();
    expect(chat.conversations[0].unreadBy.me).toBe(1);
  });

  // Ao trocar de conversa a tela nova abre antes de a antiga sair.
  it('fechar uma conversa que não é mais a aberta não fecha a outra', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation('me#w2');
      await chat.openConversation(CONV);
    });
    mockBackend.markRead.mockClear();

    act(() => chat.closeConversation('me#w2'));
    act(() => socket(doServidor('m9', 'tudo certo?', 'w1')));

    expect(mockBackend.markRead).toHaveBeenCalledWith(CONV);
  });
});

describe('ChatProvider: releitura', () => {
  let appStateHandler: ((status: AppStateStatus) => void) | null;
  let reconectar: () => Promise<void>;
  let unwatch: () => void;

  beforeEach(() => {
    // Os testes daqui trocam as respostas do backend; cada um começa das padrão.
    mockBackend.listConversations.mockImplementation(async () => [conversa()]);
    mockBackend.listDirectory.mockImplementation(async () => []);
    mockBackend.listMessages.mockImplementation(async () => []);
    appStateHandler = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateHandler = handler as (status: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    // Socket de mentira no armazém de verdade: cair e voltar avisa a volta.
    const handlers = new Map<string, (reason?: unknown) => void>();
    unwatch = connectionStatus.watch({
      on: (event: string, h: (reason?: unknown) => void) => handlers.set(event, h),
      off: (event: string) => handlers.delete(event),
    });
    handlers.get('connect')?.();
    reconectar = () =>
      act(async () => {
        handlers.get('disconnect')?.('transport close');
        handlers.get('connect')?.();
      });
  });

  afterEach(() => {
    unwatch();
    jest.restoreAllMocks();
  });

  const estados: string[] = [];
  function Estados() {
    estados.push(useChat().loadStatus);
    return null;
  }

  it('a conexão que volta relê a lista e o diretório sem passar por "carregando"', async () => {
    await act(async () => {
      montadas.push(
        create(
          <ChatProvider>
            <Estados />
            <Sonda />
          </ChatProvider>,
        ),
      );
    });
    estados.length = 0;
    mockBackend.listConversations.mockResolvedValue([conversa({ lastMessageBody: 'depois da queda' })]);
    mockBackend.listDirectory.mockResolvedValue([]);

    await reconectar();

    expect(chat.conversations[0].lastMessageBody).toBe('depois da queda');
    expect(estados).not.toContain('loading');
  });

  it('a volta ao primeiro plano relê a lista', async () => {
    await montar();
    mockBackend.listConversations.mockResolvedValue([conversa({ lastMessageBody: 'na volta' })]);

    await act(async () => appStateHandler?.('active'));

    expect(chat.conversations[0].lastMessageBody).toBe('na volta');
  });

  it('releitura que falha deixa a lista como está', async () => {
    await montar();
    mockBackend.listConversations.mockRejectedValueOnce(semRede());

    await reconectar();

    expect(chat.loadStatus).toBe('ready');
    expect(chat.conversations[0].lastMessageBody).toBe('antes');
  });

  it('cartão atualizado pelo socket enquanto a lista vinha não volta atrás', async () => {
    await montar();
    let responder!: (cs: Conversation[]) => void;
    mockBackend.listConversations.mockReturnValueOnce(new Promise((r) => (responder = r)));

    await reconectar();
    act(() => socket(doServidor('m9', 'chegou no meio', 'w1')));
    await act(async () => responder([conversa()]));

    expect(chat.conversations[0].lastMessageBody).toBe('chegou no meio');
  });

  it('relê a conversa na tela e marca como lida o que chegou durante a queda', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });
    mockBackend.markRead.mockClear();
    mockBackend.listConversations.mockResolvedValue([conversa({ unreadBy: { me: 1 } })]);
    mockBackend.listMessages.mockResolvedValueOnce([doServidor('m2', 'durante a queda', 'w1')]);

    await reconectar();

    expect(corpos()).toEqual(['durante a queda']);
    expect(mockBackend.markRead).toHaveBeenCalledWith(CONV);
    expect(chat.conversations[0].unreadBy.me).toBe(0);
  });

  it('a mensagem que o socket entregou enquanto o histórico vinha não some', async () => {
    mockBackend.listMessages.mockResolvedValueOnce([doServidor('m1', 'oi', 'w1')]);
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });

    let responder!: (ms: Message[]) => void;
    mockBackend.listMessages.mockReturnValueOnce(new Promise((r) => (responder = r)));
    await reconectar();
    act(() => socket({ ...doServidor('m3', 'no meio', 'w1'), sentAt: '2026-10-04T12:05:00.000Z' }));
    await act(async () =>
      responder([doServidor('m1', 'oi', 'w1'), doServidor('m2', 'durante a queda', 'w1')]),
    );

    expect(corpos()).toEqual(['oi', 'durante a queda', 'no meio']);
  });

  it('a mensagem relida não entra de novo quando o socket a repete', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });
    mockBackend.listMessages.mockResolvedValueOnce([doServidor('m2', 'durante a queda', 'w1')]);

    await reconectar();
    act(() => socket(doServidor('m2', 'durante a queda', 'w1')));

    expect(corpos()).toEqual(['durante a queda']);
  });

  it('releitura mais antiga que chega depois da mais nova é descartada', async () => {
    await montar();
    let primeira!: (cs: Conversation[]) => void;
    mockBackend.listConversations
      .mockReturnValueOnce(new Promise((r) => (primeira = r)))
      .mockResolvedValueOnce([conversa({ lastMessageBody: 'mais nova' })]);

    await reconectar();
    await reconectar();
    await act(async () => primeira([conversa({ lastMessageBody: 'mais antiga' })]));

    expect(chat.conversations[0].lastMessageBody).toBe('mais nova');
  });

  it('releitura mais nova que falha não joga fora a resposta da anterior', async () => {
    await montar();
    let primeira!: (cs: Conversation[]) => void;
    mockBackend.listConversations
      .mockReturnValueOnce(new Promise((r) => (primeira = r)))
      .mockRejectedValueOnce(semRede());

    await reconectar();
    await reconectar();
    await act(async () => primeira([conversa({ lastMessageBody: 'da primeira' })]));

    expect(chat.conversations[0].lastMessageBody).toBe('da primeira');
  });

  // A volta ao primeiro plano e a volta da conexão disparam duas releituras.
  it('histórico mais velho que chega depois do mais novo não desfaz a edição', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });
    let primeira!: (ms: Message[]) => void;
    mockBackend.listMessages
      .mockReturnValueOnce(new Promise((r) => (primeira = r)))
      .mockResolvedValueOnce([doServidor('m1', 'editada', 'w1')]);

    await reconectar();
    await reconectar();
    await act(async () => primeira([doServidor('m1', 'original', 'w1')]));

    expect(corpos()).toEqual(['editada']);
  });

  it('abrir a conversa não apaga o histórico mais novo que a releitura já trouxe', async () => {
    await montar();
    let doAbrir!: (ms: Message[]) => void;
    mockBackend.listMessages
      .mockReturnValueOnce(new Promise((r) => (doAbrir = r)))
      .mockResolvedValueOnce([doServidor('m1', 'oi', 'w1'), doServidor('m2', 'mais nova', 'w1')]);

    let aberta!: Promise<void>;
    act(() => {
      aberta = chat.openConversation(CONV);
    });
    await reconectar();
    await act(async () => {
      doAbrir([doServidor('m1', 'oi', 'w1')]);
      await aberta;
    });

    expect(corpos()).toEqual(['oi', 'mais nova']);
  });

  it('conversa que a tela fechou não é relida nem marcada como lida', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });
    act(() => chat.closeConversation(CONV));
    mockBackend.listMessages.mockClear();
    mockBackend.markRead.mockClear();

    await reconectar();

    expect(mockBackend.listMessages).not.toHaveBeenCalled();
    expect(mockBackend.markRead).not.toHaveBeenCalled();
  });

  it('a pessoa trocou de conversa enquanto o histórico vinha: a resposta não entra', async () => {
    await montar();
    await act(async () => {
      await chat.openConversation(CONV);
    });
    let responder!: (ms: Message[]) => void;
    mockBackend.listMessages.mockReturnValueOnce(new Promise((r) => (responder = r)));

    await reconectar();
    act(() => chat.closeConversation(CONV));
    mockBackend.markRead.mockClear();
    await act(async () => responder([doServidor('m2', 'durante a queda', 'w1')]));

    expect(corpos()).toEqual([]);
    expect(mockBackend.markRead).not.toHaveBeenCalled();
  });
});
