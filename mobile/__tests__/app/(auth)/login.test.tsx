import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Login from '../../../app/(auth)/login';
import { useAuth } from '../../../services/auth/AuthProvider';
import { useProfile } from '../../../services/profile/ProfileProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));
jest.mock('../../../services/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../../services/profile/ProfileProvider', () => ({ useProfile: jest.fn() }));

const mockUseAuth = useAuth as jest.Mock;
const mockUseProfile = useProfile as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let signIn: jest.Mock;
let loadProfile: jest.Mock;

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <Login />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const field = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChangeText === 'function',
  )[0];

const botao = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onPress === 'function',
  )[0];

const entrar = async (tree: ReturnType<typeof create>) => {
  await act(async () => {
    field(tree, 'Login').props.onChangeText('fulana@empresa.com');
    field(tree, 'Senha').props.onChangeText('senha123');
  });
  await act(async () => {
    await botao(tree, 'Entrar').props.onPress();
  });
};

beforeEach(() => {
  mockReplace.mockReset();
  signIn = jest.fn().mockResolvedValue({ id: 'u1', email: 'fulana@empresa.com', name: 'Fulana' });
  loadProfile = jest.fn();
  mockUseAuth.mockReturnValue({ signIn });
  mockUseProfile.mockReturnValue({ loadProfile });
});

// O primeiro login depois da aprovação do admin desvia pro wizard de
// complimentary-data. Perfil completo vai direto pro dashboard.
describe('login: desvio pós-aprovação', () => {
  it('perfil sem os dados do wizard → complimentary-data', async () => {
    loadProfile.mockResolvedValue({ fullName: 'Fulana Teste' });
    const tree = await render();
    await entrar(tree);
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/complimentary-data/step-1');
  });

  it('perfil completo → dashboard', async () => {
    loadProfile.mockResolvedValue({
      fullName: 'Fulana Teste',
      cpf: '529.982.247-25',
      cep: '27200-000',
      bloodType: 'O+',
    });
    const tree = await render();
    await entrar(tree);
    expect(mockReplace).toHaveBeenCalledWith('/(app)/dashboard');
  });

  // O desvio é conveniência, não gate: se a leitura do perfil falhar (rede),
  // o login não pode travar, dashboard é o destino seguro.
  it('leitura do perfil falhou → dashboard mesmo assim', async () => {
    loadProfile.mockRejectedValue(new TypeError('Network request failed'));
    const tree = await render();
    await entrar(tree);
    expect(mockReplace).toHaveBeenCalledWith('/(app)/dashboard');
  });

  it('login recusado (aguardando aprovação) → não navega', async () => {
    signIn.mockRejectedValue(new Error('Sua conta está aguardando aprovação do administrador'));
    const tree = await render();
    await entrar(tree);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

// Mesma classe do step-2: o handleLogin marca os campos como tocados pra
// revelar o erro de cada um, mas `disabled={!canSubmit}` impediria o onPress
// de chegar lá, o bloco viraria código morto e o toque sumiria no vazio.
//
// A asserção de `disabled` é o coração do teste, e é sutil: o DS faz
// `onPress={disabled ? undefined : onPress}` no Pressable interno, então
// chamar onPress() do elemento externo CONTORNA o disabled e passaria mesmo
// com a regressão presente. Sem ela o teste não tem dente.
describe('login: Entrar com formulário incompleto', () => {
  it('mantém o botão habilitado para que o toque chegue à validação', async () => {
    const tree = await render();
    expect(botao(tree, 'Entrar').props.disabled).toBeFalsy();
  });

  it('revela o erro dos campos obrigatórios em vez de engolir o toque', async () => {
    const tree = await render();
    expect(field(tree, 'Login').props.description).toBeFalsy();

    await act(async () => {
      await botao(tree, 'Entrar').props.onPress();
    });

    expect(field(tree, 'Login').props.descriptionVariant).toBe('error');
    expect(field(tree, 'Login').props.description).toBeTruthy();
    expect(field(tree, 'Senha').props.descriptionVariant).toBe('error');
  });

  it('continua NÃO autenticando enquanto o formulário está inválido', async () => {
    const tree = await render();

    await act(async () => {
      await botao(tree, 'Entrar').props.onPress();
    });

    expect(signIn).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
