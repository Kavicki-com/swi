import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import PasswordRecoveryEmail from '../../../../app/(auth)/password-recovery/email';
import { useAuth } from '../../../../services/auth/AuthProvider';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));
jest.mock('../../../../services/auth/AuthProvider', () => ({ useAuth: jest.fn() }));

const mockUseAuth = useAuth as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let resetPassword: jest.Mock;

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <PasswordRecoveryEmail />
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

beforeEach(() => {
  mockPush.mockClear();
  resetPassword = jest.fn().mockResolvedValue(undefined);
  mockUseAuth.mockReturnValue({ resetPassword });
});

// Mesma classe de defeito do QA Mobile #1 (corrigido no step-2 em 6ff9c1f e
// encontrado aqui pela varredura): o handleSubmit já marca o campo como
// tocado pra revelar o erro, mas `disabled={!canSubmit || enviando}` impedia
// o onPress de chegar lá. O bloco era código morto e o toque sumia no vazio.
//
// A asserção de `disabled` é o coração do teste, e é sutil: o DS faz
// `onPress={disabled ? undefined : onPress}` no Pressable interno, então
// chamar onPress() do elemento externo CONTORNA o disabled e passaria mesmo
// com o bug de volta. Sem ela o teste não tem dente.
describe('recuperar senha — Enviar Link com e-mail inválido', () => {
  it('mantém o botão habilitado para que o toque chegue à validação', async () => {
    const tree = await render();
    expect(botao(tree, 'Enviar Link').props.disabled).toBeFalsy();
  });

  it('revela o erro do e-mail em vez de engolir o toque', async () => {
    const tree = await render();
    expect(field(tree, 'e-mail').props.description).toBeFalsy();

    await act(async () => {
      await botao(tree, 'Enviar Link').props.onPress();
    });

    expect(field(tree, 'e-mail').props.descriptionVariant).toBe('error');
    expect(field(tree, 'e-mail').props.description).toBeTruthy();
  });

  it('continua NÃO enviando o link enquanto o e-mail está inválido', async () => {
    const tree = await render();

    await act(async () => {
      await botao(tree, 'Enviar Link').props.onPress();
    });

    expect(resetPassword).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
