import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import ChatInbox from '../../../../app/(app)/chat/inbox';
import { useChat } from '../../../../services/chat/ChatProvider';

jest.mock('../../../../services/chat/ChatProvider', () => ({ useChat: jest.fn() }));

// Prefixo `mock` e exigencia do hoisting do jest.mock: sem ele o babel-plugin
// recusa a referencia a variavel de fora da factory.
const mockPush = jest.fn();
const mockBack = jest.fn();
// Objeto ESTAVEL. Com `back: jest.fn()` criado dentro da factory, cada render
// ganhava um espiao novo e nao havia como afirmar que a tela voltou.
const mockRouter = { push: mockPush, back: mockBack };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockUseChat = useChat as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// Contato sintetico do diretorio: quem o app oferece pra iniciar conversa.
const MARIA = {
  workerId: 'w2',
  name: 'Maria Souza',
  sector: 'Manutencao',
  role: 'Tecnica',
  avatarUri: '',
};

const chatState = (over: Record<string, unknown> = {}) => ({
  myId: 'w1',
  loadStatus: 'empty' as const,
  conversations: [],
  directory: [MARIA],
  load: jest.fn(),
  messagesFor: () => [],
  openConversation: jest.fn(),
  send: jest.fn(),
  keyFor: (id: string) => ['w1', id].sort().join('#'),
  ...over,
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <ChatInbox />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// Alvo pelo label visivel, como o usuario encontra o controle na tela.
const byLabel = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function')[0];

const byName = (tree: ReturnType<typeof create>, name: string) =>
  tree.root.findAll((n) => n.props?.name === name && typeof n.props?.onPress === 'function')[0];

const press = async (node: ReactTestInstance) => {
  await act(async () => { node.props.onPress(); });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseChat.mockReturnValue(chatState());
});

describe('ChatInbox — QA Mobile #7', () => {
  // Sem conversa alguma, a tela caia num estado terminal ("Nenhuma conversa")
  // que nao trazia o botao Novo Chat: o usuario ficava sem NENHUM caminho pro
  // diretorio, e o app parecia nao ter mais ninguem na plataforma.
  it('oferece Novo Chat mesmo quando nao existe nenhuma conversa', async () => {
    const tree = await render();
    expect(byLabel(tree, 'Novo Chat')).toBeDefined();
  });

  it('abre o diretorio a partir do estado vazio e permite iniciar conversa', async () => {
    const tree = await render();
    await press(byLabel(tree, 'Novo Chat'));

    const contato = byName(tree, 'Maria Souza');
    expect(contato).toBeDefined();

    await press(contato);
    expect(mockPush).toHaveBeenCalledWith('/(app)/chat/w2');
  });

  it('mantem o aviso de caixa vazia enquanto nao ha conversa', async () => {
    const tree = await render();
    const textos = tree.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string);
    expect(textos).toContain('Nenhuma conversa');
  });

  // O provider monta com status 'idle' e so vira 'loading' depois do primeiro
  // efeito: esse primeiro frame nao pode afirmar "Nenhuma conversa" antes de a
  // busca sequer comecar.
  it('nao mostra o aviso de caixa vazia antes de carregar (idle)', async () => {
    mockUseChat.mockReturnValue(chatState({ loadStatus: 'idle' }));
    const tree = await render();
    const textos = tree.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string);
    expect(textos).not.toContain('Nenhuma conversa');
    expect(textos).toContain('Carregando conversas…');
  });
});

// ---------------------------------------------------------------------------
// A suite acima nasceu do QA #7 e sempre rodou com a caixa VAZIA. Por isso a
// lista de conversas em si, que e o corpo da tela, nunca tinha sido montada:
// nenhum card, nenhuma busca sobre conversas, nenhuma barra de rolagem.
// ---------------------------------------------------------------------------

// Conversa de verdade tem arrays paralelos: o contato exibido e o participante
// que NAO sou eu, resolvido por resolveContact a partir do myId.
const CONVERSA = {
  id: 'c1',
  participants: ['w1', 'w2'],
  participantNames: ['Eu', 'Maria Souza'],
  participantSubtitles: ['Operacoes', 'Manutencao'],
  participantAvatars: ['', ''],
  lastMessageBody: 'bom dia',
  lastMessageAt: '2026-08-01T10:00:00.000Z',
  unreadBy: { w1: 3 },
};

const OUTRA = {
  ...CONVERSA,
  id: 'c2',
  participants: ['w1', 'w3'],
  participantNames: ['Eu', 'Carlos Lima'],
  participantSubtitles: ['Operacoes', 'Seguranca'],
  unreadBy: {},
};

const comConversas = () =>
  mockUseChat.mockReturnValue(
    chatState({ loadStatus: 'ready', conversations: [CONVERSA, OUTRA] }),
  );

const digitar = async (tree: ReturnType<typeof create>, texto: string) => {
  const campo = tree.root.findAll((n) => typeof n.props?.onChangeText === 'function')[0];
  await act(async () => {
    campo.props.onChangeText(texto);
  });
};

const estado = (tree: ReturnType<typeof create>, kind: string) =>
  tree.root.findAll((n) => n.props?.kind === kind)[0];

describe('ChatInbox, a lista de conversas', () => {
  it('mostra um card por conversa, nomeado pelo outro participante', async () => {
    comConversas();
    const tree = await render();

    expect(byName(tree, 'Maria Souza')).toBeDefined();
    expect(byName(tree, 'Carlos Lima')).toBeDefined();
  });

  it('o card traz o setor do contato e o que ficou por ler', async () => {
    comConversas();
    const tree = await render();

    const card = byName(tree, 'Maria Souza');
    expect(card.props.subtitle).toBe('Manutencao');
    expect(card.props.unreadCount).toBe(3);
  });

  // Sem contagem propria, uma conversa lida herdaria o badge da anterior.
  it('conversa sem pendencia nao mostra contagem', async () => {
    comConversas();
    const tree = await render();

    expect(byName(tree, 'Carlos Lima').props.unreadCount).toBe(0);
  });

  it('tocar num card abre a conversa daquele contato', async () => {
    comConversas();
    const tree = await render();

    await press(byName(tree, 'Maria Souza'));

    expect(mockPush).toHaveBeenCalledWith('/(app)/chat/w2');
  });

  it('a busca filtra as conversas pelo nome do contato, sem ligar pra caixa', async () => {
    comConversas();
    const tree = await render();

    await digitar(tree, 'cARLos');

    expect(byName(tree, 'Carlos Lima')).toBeDefined();
    expect(byName(tree, 'Maria Souza')).toBeUndefined();
  });

  it('Voltar sai da tela', async () => {
    comConversas();
    const tree = await render();

    await press(byLabel(tree, 'Voltar'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('ChatInbox, ida e volta ao diretorio', () => {
  it('voltar do diretorio devolve as conversas e limpa o termo digitado', async () => {
    comConversas();
    const tree = await render();

    await press(byLabel(tree, 'Novo Chat'));
    await digitar(tree, 'maria');
    expect(byName(tree, 'Maria Souza')).toBeDefined();

    await press(byLabel(tree, 'Voltar às conversas'));

    // Carlos so reaparece se o termo tiver sido zerado junto com o modo: com
    // "maria" ainda no campo, a lista de conversas voltaria filtrada.
    expect(byName(tree, 'Carlos Lima')).toBeDefined();
    expect(byLabel(tree, 'Novo Chat')).toBeDefined();
  });
});

describe('ChatInbox, carga que falha', () => {
  it('mostra o estado de erro e o retry refaz a busca', async () => {
    const load = jest.fn();
    mockUseChat.mockReturnValue(chatState({ loadStatus: 'error', load }));
    const tree = await render();

    expect(estado(tree, 'error')).toBeDefined();

    await act(async () => {
      estado(tree, 'error').props.onRetry();
    });

    expect(load).toHaveBeenCalledTimes(1);
  });

  // O chrome tem que sobreviver ao erro: sem a topbar a pessoa fica presa na
  // tela, sem nem o caminho de volta.
  it('mesmo em erro a tela mantem o caminho de volta', async () => {
    mockUseChat.mockReturnValue(chatState({ loadStatus: 'error' }));
    const tree = await render();

    await press(byLabel(tree, 'Voltar'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('ChatInbox, barra de rolagem propria', () => {
  // O jest nao tem motor de layout: quem informa altura visivel e altura de
  // conteudo e o proprio ScrollView, pelos dois callbacks. E exatamente o que
  // a tela recebe em aparelho.
  const medir = async (
    tree: ReturnType<typeof create>,
    visivel: number,
    conteudo: number,
  ) => {
    const lista = tree.root.findAll(
      (n) => typeof n.props?.onContentSizeChange === 'function',
    )[0];
    await act(async () => {
      lista.props.onLayout({ nativeEvent: { layout: { height: visivel } } });
      lista.props.onContentSizeChange(0, conteudo);
    });
  };

  // A trilha e inerte ao toque: ela nao pode roubar o gesto da lista.
  //
  // `deep: false` conta a trilha UMA vez. O elemento View e a host view que ele
  // renderiza carregam os mesmos props, entao a busca profunda devolve dois nos
  // pra uma barra so, e a contagem viraria o dobro do que existe na tela.
  const trilha = (tree: ReturnType<typeof create>) =>
    tree.root.findAll((n) => n.props?.pointerEvents === 'none', { deep: false });

  const alturaDoPolegar = (tree: ReturnType<typeof create>) => {
    const alvo = trilha(tree)[0].findAll((n) => {
      const s = StyleSheet.flatten(n.props?.style) as { height?: number } | undefined;
      return typeof s?.height === 'number';
    })[0];
    return (StyleSheet.flatten(alvo.props.style) as { height: number }).height;
  };

  it('nao aparece enquanto a lista cabe na tela', async () => {
    comConversas();
    const tree = await render();
    expect(trilha(tree)).toHaveLength(0);

    await medir(tree, 400, 300);

    expect(trilha(tree)).toHaveLength(0);
  });

  it('aparece quando o conteudo passa da altura visivel', async () => {
    comConversas();
    const tree = await render();

    await medir(tree, 400, 1000);

    expect(trilha(tree)).toHaveLength(1);
  });

  it('o polegar ocupa a fracao visivel da lista', async () => {
    comConversas();
    const tree = await render();

    await medir(tree, 400, 1000);

    // (400 / 1000) * 400 = 160
    expect(alturaDoPolegar(tree)).toBe(160);
  });

  // Sem o piso, uma lista muito longa reduziria o polegar a poucos pixels e
  // ninguem conseguiria enxergar onde esta.
  it('o polegar nunca fica menor que 24', async () => {
    comConversas();
    const tree = await render();

    // (100 / 5000) * 100 = 2, abaixo do piso
    await medir(tree, 100, 5000);

    expect(alturaDoPolegar(tree)).toBe(24);
  });
});
