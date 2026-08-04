import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import ChatInbox from '../../../../app/(app)/chat/inbox';
import { useChat } from '../../../../services/chat/ChatProvider';

jest.mock('../../../../services/chat/ChatProvider', () => ({ useChat: jest.fn() }));

// Prefixo `mock` e exigencia do hoisting do jest.mock: sem ele o babel-plugin
// recusa a referencia a variavel de fora da factory.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));

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
