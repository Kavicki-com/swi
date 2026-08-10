import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import PasswordRecoveryNewPassword from '../../../../app/(auth)/password-recovery/new-password';
import { useAuth } from '../../../../services/auth/AuthProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: mockReplace }),
  useLocalSearchParams: () => ({ email: 'fulana@empresa.com' }),
}));
jest.mock('../../../../services/auth/AuthProvider', () => ({ useAuth: jest.fn() }));

const mockUseAuth = useAuth as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let confirmReset: jest.Mock;

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <PasswordRecoveryNewPassword />
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
  mockReplace.mockClear();
  confirmReset = jest.fn().mockResolvedValue(undefined);
  mockUseAuth.mockReturnValue({ confirmReset });
});

// Mesma classe de defeito do QA Mobile #1 (corrigido no step-2 em 6ff9c1f e
// encontrado aqui pela varredura): o handleSubmit já marca os campos como
// tocados pra revelar o erro de cada um, mas `disabled={!canSubmit || enviando}`
// impedia o onPress de chegar lá. O bloco era código morto.
//
// Aqui o custo do silêncio é maior que no step-2: as regras de senha (8+
// caracteres, maiúscula, número, símbolo) não estão escritas na tela. Sem a
// mensagem, a pessoa não tem como adivinhar qual regra falhou.
//
// A asserção de `disabled` é o coração do teste, e é sutil: o DS faz
// `onPress={disabled ? undefined : onPress}` no Pressable interno, então
// chamar onPress() do elemento externo CONTORNA o disabled e passaria mesmo
// com o bug de volta. Sem ela o teste não tem dente.
describe('nova senha: Alterar senha com formulário incompleto', () => {
  it('mantém o botão habilitado para que o toque chegue à validação', async () => {
    const tree = await render();
    expect(botao(tree, 'Alterar senha').props.disabled).toBeFalsy();
  });

  it('revela o erro dos campos de senha em vez de engolir o toque', async () => {
    const tree = await render();
    expect(field(tree, 'Nova Senha').props.description).toBeFalsy();

    await act(async () => {
      await botao(tree, 'Alterar senha').props.onPress();
    });

    expect(field(tree, 'Nova Senha').props.descriptionVariant).toBe('error');
    expect(field(tree, 'Nova Senha').props.description).toBeTruthy();
    expect(field(tree, 'Confirmar nova senha').props.descriptionVariant).toBe('error');
  });

  // Senha que passa nas regras mas não bate com a confirmação: o caso em que
  // o usuário mais precisa da mensagem, porque os dois campos ficam mascarados
  // e ele não consegue comparar o que digitou.
  it('diz que as senhas não coincidem em vez de só não fazer nada', async () => {
    const tree = await render();

    await act(async () => {
      field(tree, 'Nova Senha').props.onChangeText('Senha@123');
      field(tree, 'Confirmar nova senha').props.onChangeText('Senha@124');
    });
    await act(async () => {
      await botao(tree, 'Alterar senha').props.onPress();
    });

    expect(field(tree, 'Confirmar nova senha').props.descriptionVariant).toBe('error');
    expect(field(tree, 'Confirmar nova senha').props.description).toBeTruthy();
    expect(confirmReset).not.toHaveBeenCalled();
  });

  it('continua NÃO trocando a senha enquanto o formulário está inválido', async () => {
    const tree = await render();

    await act(async () => {
      await botao(tree, 'Alterar senha').props.onPress();
    });

    expect(confirmReset).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
