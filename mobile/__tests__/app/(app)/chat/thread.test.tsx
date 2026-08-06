import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import ChatThread from '../../../../app/(app)/chat/[userId]';
import type { Contact, Conversation, Message } from '../../../../services/chat/types';

// Thread do chat (app/(app)/chat/[userId].tsx).
//
// O ponto mais delicado da tela é o estado de três valores: `messagesFor` não
// distingue "ainda carregando" de "carregou e está vazia", e uma rejeição não
// pode cair em 'ready' — renderizaria como conversa vazia e esconderia a falha.
// Por isso o load usa .then(ok, err) e NÃO .finally.
//
// A outra: enviar durante o loading descartaria a mensagem em silêncio, porque
// o provider só faz live-append depois do openConversation.

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { userId?: string } = { userId: 'w1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

const mockShowPicker = jest.fn();
jest.mock('../../../../lib/media/useMediaPicker', () => ({
  useMediaPicker: () => ({
    showPicker: mockShowPicker,
    takePhoto: jest.fn(),
    pickFromGallery: jest.fn(),
  }),
}));

const mockChat = {
  myId: 'me',
  keyFor: (id: string) => `c-me-${id}`,
  messagesFor: jest.fn(),
  openConversation: jest.fn(),
  send: jest.fn(),
  conversations: [] as Conversation[],
  directory: [] as Contact[],
};
jest.mock('../../../../services/chat/ChatProvider', () => ({ useChat: () => mockChat }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const contato = (over: Partial<Contact> = {}): Contact => ({
  workerId: 'w1',
  name: 'Ana Souza',
  sector: 'Setor Leste',
  role: 'Operadora',
  avatarUri: 'https://example.test/w1.png',
  ...over,
});

const conversa = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c-me-w1',
  participants: ['me', 'w1'],
  participantNames: ['Eu', 'Ana Souza'],
  participantSubtitles: ['Setor Norte', 'Setor Leste'],
  participantAvatars: ['https://example.test/me.png', 'https://example.test/w1.png'],
  lastMessageBody: 'Bom dia',
  lastMessageAt: '2026-08-06T13:05:00.000Z',
  unreadBy: {},
  ...over,
});

const mensagem = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'c-me-w1',
  participants: ['me', 'w1'],
  senderId: 'me',
  body: 'Bom dia',
  imageUri: null,
  sentAt: '2026-08-06T13:05:00.000Z',
  ...over,
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <ChatThread />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const textos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

const porLabel = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
  )[0];

const tocar = async (tree: ReturnType<typeof create>, label: string) => {
  await act(async () => { await porLabel(tree, label).props.onPress(); });
};

// O TextInput da mensagem: único campo com placeholder de digitação.
const entrada = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.props?.placeholder === 'Digite aqui sua mensagem')[0];

const digitar = async (tree: ReturnType<typeof create>, texto: string) => {
  await act(async () => { entrada(tree).props.onChangeText(texto); });
};

const bolhas = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.message === 'string' && typeof n.props?.position === 'string')
    .map((n) => n.props as { message: string; position: string; time: string; avatarUri?: string });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { userId: 'w1' };
  mockChat.conversations = [];
  mockChat.directory = [];
  mockChat.messagesFor.mockReturnValue([]);
  mockChat.openConversation.mockResolvedValue(undefined);
  mockShowPicker.mockResolvedValue(null);
});

describe('Thread do chat — estados de carregamento', () => {
  it('mostra o carregando enquanto a conversa não abre', async () => {
    mockChat.openConversation.mockReturnValue(new Promise(() => {}));
    const tree = await render();

    expect(textos(tree)).toContain('Carregando mensagens…');
  });

  // Conversa nova é diferente de falha: convida a mandar a primeira mensagem.
  it('conversa aberta e sem mensagens convida a começar', async () => {
    const tree = await render();

    expect(textos(tree)).toContain('Nenhuma mensagem ainda');
  });

  // Com .finally toda falha caía em 'ready' e a tela mentia "conversa vazia".
  it('falha ao abrir mostra erro com retry, não conversa vazia', async () => {
    mockChat.openConversation.mockRejectedValue(new Error('rede'));
    const tree = await render();
    const t = textos(tree);

    expect(t).toContain('Não foi possível carregar');
    expect(t).not.toContain('Nenhuma mensagem ainda');
    expect(porLabel(tree, 'Tentar carregar as mensagens de novo')).toBeDefined();
  });

  it('o retry abre a conversa de novo e chega às mensagens', async () => {
    mockChat.openConversation.mockRejectedValueOnce(new Error('rede'));
    const tree = await render();

    mockChat.openConversation.mockResolvedValue(undefined);
    mockChat.messagesFor.mockReturnValue([mensagem({ body: 'Bom dia' })]);
    await tocar(tree, 'Tentar carregar as mensagens de novo');

    expect(mockChat.openConversation).toHaveBeenCalledTimes(2);
    expect(bolhas(tree).map((b) => b.message)).toContain('Bom dia');
  });

  it('abre a conversa pelo id derivado do contato', async () => {
    await render();
    expect(mockChat.openConversation).toHaveBeenCalledWith('c-me-w1');
  });
});

describe('Thread do chat — mensagens', () => {
  it('minha mensagem e a do contato ficam em lados opostos', async () => {
    mockChat.messagesFor.mockReturnValue([
      mensagem({ id: 'm1', senderId: 'me', body: 'Bom dia' }),
      mensagem({ id: 'm2', senderId: 'w1', body: 'Bom dia, tudo certo?' }),
    ]);
    const tree = await render();
    const b = bolhas(tree);

    expect(b.find((x) => x.message === 'Bom dia')?.position).toBe('left');
    expect(b.find((x) => x.message === 'Bom dia, tudo certo?')?.position).toBe('right');
  });

  // O horário era literal do seed; agora sai do sentAt da mensagem.
  it('o horário da bolha vem do sentAt, não de texto fixo', async () => {
    const sentAt = '2026-08-06T13:05:00.000Z';
    mockChat.messagesFor.mockReturnValue([mensagem({ sentAt })]);
    const tree = await render();

    const esperado = new Date(sentAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(bolhas(tree)[0].time).toBe(esperado);
  });

  it('cada bolha usa o avatar de quem enviou', async () => {
    mockChat.directory = [
      contato(),
      contato({ workerId: 'me', name: 'Eu', avatarUri: 'https://example.test/me.png' }),
    ];
    mockChat.conversations = [conversa()];
    mockChat.messagesFor.mockReturnValue([
      mensagem({ id: 'm1', senderId: 'me' }),
      mensagem({ id: 'm2', senderId: 'w1' }),
    ]);
    const tree = await render();
    const b = bolhas(tree);

    expect(b[0].avatarUri).toBe('https://example.test/me.png');
    expect(b[1].avatarUri).toBe('https://example.test/w1.png');
  });

  // Sem registro meu no diretório, reusar o avatar do contato é melhor do que
  // uma bolha sem avatar nenhum.
  it('sem meu registro no diretório reusa o avatar do contato', async () => {
    mockChat.directory = [contato()];
    mockChat.conversations = [conversa()];
    mockChat.messagesFor.mockReturnValue([mensagem({ senderId: 'me' })]);
    const tree = await render();

    expect(bolhas(tree)[0].avatarUri).toBe('https://example.test/w1.png');
  });
});

describe('Thread do chat — cabeçalho do contato', () => {
  it('conversa existente resolve o contato pelos participantes', async () => {
    mockChat.conversations = [conversa()];
    mockChat.messagesFor.mockReturnValue([mensagem()]);
    const tree = await render();

    const avatar = tree.root.findAll(
      (n) => n.props?.customSize === 40 && typeof n.props?.uri === 'string',
    )[0];
    expect(avatar.props.uri).toBe('https://example.test/w1.png');
  });

  // Conversa que ainda não existe: o contato vem do diretório pelo workerId.
  it('conversa nova cai no diretório pelo id do contato', async () => {
    mockChat.conversations = [];
    mockChat.directory = [contato({ avatarUri: 'https://example.test/novo.png' })];
    const tree = await render();

    const avatar = tree.root.findAll(
      (n) => n.props?.customSize === 40 && typeof n.props?.uri === 'string',
    )[0];
    expect(avatar.props.uri).toBe('https://example.test/novo.png');
  });

  it('contato desconhecido não quebra a tela', async () => {
    mockChat.conversations = [];
    mockChat.directory = [];
    const tree = await render();

    expect(textos(tree)).toContain('Nenhuma mensagem ainda');
  });

  it('o avatar do topo abre a ficha do contato', async () => {
    const tree = await render();
    await tocar(tree, 'Ver perfil do contato');

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(app)/chat/user-info',
      params: { userId: 'w1' },
    });
  });

  it('"Voltar" sai da conversa', async () => {
    const tree = await render();
    await tocar(tree, 'Voltar');

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('Thread do chat — envio', () => {
  it('manda o texto para a conversa e limpa o campo', async () => {
    const tree = await render();
    await digitar(tree, 'Bom dia');
    await tocar(tree, 'Enviar');

    expect(mockChat.send).toHaveBeenCalledWith('c-me-w1', 'Bom dia', undefined);
    expect(entrada(tree).props.value).toBe('');
  });

  it('a tecla de envio do teclado manda igual ao botão', async () => {
    const tree = await render();
    await digitar(tree, 'Bom dia');
    await act(async () => { entrada(tree).props.onSubmitEditing(); });

    expect(mockChat.send).toHaveBeenCalledWith('c-me-w1', 'Bom dia', undefined);
  });

  it('mensagem só de espaço não é enviada', async () => {
    const tree = await render();
    await digitar(tree, '    ');
    await tocar(tree, 'Enviar');

    expect(mockChat.send).not.toHaveBeenCalled();
  });

  it('campo vazio não envia nada', async () => {
    const tree = await render();
    await tocar(tree, 'Enviar');

    expect(mockChat.send).not.toHaveBeenCalled();
  });

  // O provider só faz live-append depois do openConversation: enviar antes
  // descartaria a mensagem em silêncio.
  it('não envia enquanto a conversa está carregando', async () => {
    mockChat.openConversation.mockReturnValue(new Promise(() => {}));
    const tree = await render();
    await digitar(tree, 'Bom dia');
    await tocar(tree, 'Enviar');

    expect(mockChat.send).not.toHaveBeenCalled();
  });

  it('não envia depois de falhar em abrir a conversa', async () => {
    mockChat.openConversation.mockRejectedValue(new Error('rede'));
    const tree = await render();
    await digitar(tree, 'Bom dia');
    await tocar(tree, 'Enviar');

    expect(mockChat.send).not.toHaveBeenCalled();
  });
});

describe('Thread do chat — anexo', () => {
  it('o arquivo escolhido aparece como prévia antes de enviar', async () => {
    mockShowPicker.mockResolvedValue('file:///foto.jpg');
    const tree = await render();
    await tocar(tree, 'Anexar arquivo');

    expect(porLabel(tree, 'Remover anexo')).toBeDefined();
  });

  it('cancelar o seletor não deixa prévia', async () => {
    mockShowPicker.mockResolvedValue(null);
    const tree = await render();
    await tocar(tree, 'Anexar arquivo');

    expect(porLabel(tree, 'Remover anexo')).toBeUndefined();
  });

  it('anexo sozinho, sem texto, é enviado', async () => {
    mockShowPicker.mockResolvedValue('file:///foto.jpg');
    const tree = await render();
    await tocar(tree, 'Anexar arquivo');
    await tocar(tree, 'Enviar');

    expect(mockChat.send).toHaveBeenCalledWith('c-me-w1', '', 'file:///foto.jpg');
  });

  it('texto e anexo vão juntos, e a prévia sai depois do envio', async () => {
    mockShowPicker.mockResolvedValue('file:///foto.jpg');
    const tree = await render();
    await digitar(tree, 'Olha isso');
    await tocar(tree, 'Anexar arquivo');
    await tocar(tree, 'Enviar');

    expect(mockChat.send).toHaveBeenCalledWith('c-me-w1', 'Olha isso', 'file:///foto.jpg');
    expect(porLabel(tree, 'Remover anexo')).toBeUndefined();
  });

  it('tocar na prévia remove o anexo', async () => {
    mockShowPicker.mockResolvedValue('file:///foto.jpg');
    const tree = await render();
    await tocar(tree, 'Anexar arquivo');
    await tocar(tree, 'Remover anexo');

    expect(porLabel(tree, 'Remover anexo')).toBeUndefined();
    await digitar(tree, 'Bom dia');
    await tocar(tree, 'Enviar');
    expect(mockChat.send).toHaveBeenCalledWith('c-me-w1', 'Bom dia', undefined);
  });
});
