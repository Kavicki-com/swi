import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Step2 from '../../../../app/(auth)/complimentary-data/step-2';
import { useProfile } from '../../../../services/profile/ProfileProvider';
import { useAuth } from '../../../../services/auth/AuthProvider';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));
jest.mock('../../../../services/profile/ProfileProvider', () => ({ useProfile: jest.fn() }));
jest.mock('../../../../services/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
// Mockado pra não bater no ViaCEP durante o teste.
jest.mock('../../../../lib/cep/useCepLookup', () => ({
  useCepLookup: () => ({ loading: false, lookup: jest.fn() }),
}));

const mockUseProfile = useProfile as jest.Mock;
const mockUseAuth = useAuth as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <Step2 />
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

const button = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function')[0];

beforeEach(() => {
  mockPush.mockClear();
  mockUseProfile.mockReturnValue({ profile: null, saveProfile: jest.fn() });
  mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'worker@exemplo.test', name: 'Worker' } });
});

// QA Mobile #1 (30/07/2026), URGENTE: "ao tocar em Avançar, o cadastro não
// avança e não avisa quais campos estão faltando ou inválidos (ex.: Número
// está vazio)".
//
// A causa não era validação ausente: o `goNext` SEMPRE teve o caminho certo,
// marcando todos os campos como tocados pra revelar o erro de cada um. O que
// matava era `disabled={!canSubmit}` no botão. Botão desabilitado não dispara
// onPress, então aquele bloco era código morto e o toque sumia no vazio.
describe('step-2 — Avançar com formulário incompleto', () => {
  // Esta asserção é o coração do teste, e é sutil: o DS faz
  // `onPress={disabled ? undefined : onPress}` no Pressable interno. Chamar
  // `onPress()` do elemento externo (como o teste abaixo faz) CONTORNA o
  // disabled e passaria mesmo com o bug de volta. Verificado na prática.
  // Por isso o estado desabilitado é checado explicitamente aqui.
  it('mantém o botão habilitado para que o toque chegue à validação', async () => {
    const tree = await render();
    expect(button(tree, 'Avançar').props.disabled).toBeFalsy();
  });

  it('revela o erro dos campos obrigatórios em vez de engolir o toque', async () => {
    const tree = await render();

    // Nenhum campo preenchido: pristine, então ainda sem mensagem de erro.
    expect(field(tree, 'Número').props.description).toBeFalsy();

    await act(async () => {
      button(tree, 'Avançar').props.onPress();
    });

    // O usuário agora VÊ o que falta, em vez de um botão inerte.
    const numero = field(tree, 'Número');
    expect(numero.props.descriptionVariant).toBe('error');
    expect(numero.props.description).toBeTruthy();
  });

  it('continua NÃO avançando enquanto o formulário está inválido', async () => {
    const tree = await render();

    await act(async () => {
      button(tree, 'Avançar').props.onPress();
    });

    // Habilitar o botão não afrouxou a validação: quem decide navegar
    // continua sendo o canSubmit dentro do goNext.
    expect(mockPush).not.toHaveBeenCalled();
  });
});
