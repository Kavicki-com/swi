import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Login from './login';
import { useAuth } from '../../services/auth/AuthProvider';
import { useProfile } from '../../services/profile/ProfileProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));
jest.mock('../../services/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../services/profile/ProfileProvider', () => ({ useProfile: jest.fn() }));

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

const entrar = async (tree: ReturnType<typeof create>) => {
  await act(async () => {
    field(tree, 'Login').props.onChangeText('fulana@empresa.com');
    field(tree, 'Senha').props.onChangeText('senha123');
  });
  const botao = tree.root.findAll(
    (n) => n.props?.label === 'Entrar' && typeof n.props?.onPress === 'function',
  )[0];
  await act(async () => {
    await botao.props.onPress();
  });
};

beforeEach(() => {
  mockReplace.mockReset();
  signIn = jest.fn().mockResolvedValue({ id: 'u1', email: 'fulana@empresa.com', name: 'Fulana' });
  loadProfile = jest.fn();
  mockUseAuth.mockReturnValue({ signIn });
  mockUseProfile.mockReturnValue({ loadProfile });
});

// Fluxo 2 do cadastro (reordenação 2026-07-27): o primeiro login depois da
// aprovação do admin desvia pro wizard de complimentary-data. Perfil completo
// vai direto pro dashboard.
describe('login — desvio pós-aprovação', () => {
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
  // o login não pode travar — dashboard é o destino seguro.
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
