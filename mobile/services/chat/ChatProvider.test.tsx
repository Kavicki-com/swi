import { act, create } from 'react-test-renderer';
import { ChatProvider, useChat } from './ChatProvider';
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

async function montar() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <ChatProvider>
        <Sonda />
      </ChatProvider>,
    );
  });
  return tree;
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
