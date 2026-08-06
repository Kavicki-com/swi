import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SignUp from '../../../app/(auth)/sign-up';

// Cadastro no fluxo MOCK (AUTH_BACKEND !== 'api'). Só o fluxo api tem empresas
// reais pra escolher; aqui o seletor some e o cadastro fica idêntico ao anterior.
//
// Arquivo separado de propósito: `NEEDS_COMPANY` é calculado no MÓDULO da tela,
// então o valor de AUTH_BACKEND congela no import. Re-importar a tela no mesmo
// arquivo com jest.isolateModules criaria uma segunda cópia do React e o render
// morre em "Cannot read properties of null (reading 'useContext')".
jest.mock('../../../lib/featureFlags', () => ({ AUTH_BACKEND: 'mock' }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

const mockSignUp = jest.fn();
jest.mock('../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ signUp: mockSignUp }),
}));

const mockListCompanies = jest.fn();
jest.mock('../../../services/api/companies', () => ({
  listCompanies: () => mockListCompanies(),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const SENHA = 'Segura1@';

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <SignUp />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const campo = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChangeText === 'function',
  )[0];

const digitar = async (tree: ReturnType<typeof create>, label: string, texto: string) => {
  await act(async () => { campo(tree, label).props.onChangeText(texto); });
};

let alerta: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockSignUp.mockResolvedValue(undefined);
});

afterEach(() => {
  alerta.mockRestore();
});

describe('Cadastro no fluxo mock', () => {
  it('não mostra seletor de empresa nem busca o catálogo', async () => {
    const tree = await render();

    expect(
      tree.root.findAll(
        (n) => n.props?.label === 'Empresa' && typeof n.props?.onChange === 'function',
      ),
    ).toHaveLength(0);
    expect(mockListCompanies).not.toHaveBeenCalled();
  });

  it('cria a conta sem vínculo de empresa', async () => {
    const tree = await render();
    await digitar(tree, 'Nome completo', 'Fulano de Tal');
    await digitar(tree, 'Email', 'fulano@empresa.com');
    await digitar(tree, 'Crie uma senha', SENHA);
    await digitar(tree, 'Confirme sua senha', SENHA);

    const checkbox = tree.root.findAll(
      (n) => typeof n.props?.onChange === 'function' && typeof n.props?.checked === 'boolean',
    )[0];
    await act(async () => { checkbox.props.onChange(true); });

    const criar = tree.root.findAll(
      (n) => n.props?.label === 'Criar conta' && typeof n.props?.onPress === 'function',
    )[0];
    await act(async () => { await criar.props.onPress(); });

    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'fulano@empresa.com',
      password: SENHA,
      name: 'Fulano de Tal',
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(auth)/email-sent',
      params: { email: 'fulano@empresa.com' },
    });
  });
});
