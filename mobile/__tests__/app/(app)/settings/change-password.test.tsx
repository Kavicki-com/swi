import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SettingsChangePassword from '../../../../app/(app)/settings/change-password';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

const mockChangePassword = jest.fn();
jest.mock('../../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ changePassword: mockChangePassword }),
}));

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
          <SettingsChangePassword />
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
  mockBack.mockClear();
  mockChangePassword.mockReset();
});

describe('alterar senha — submissão real', () => {
  const preenche = async (tree: ReturnType<typeof create>) => {
    await act(async () => {
      field(tree, 'Senha atual').props.onChangeText('velha123');
      field(tree, 'Nova senha').props.onChangeText('Nova@1234');
      field(tree, 'Repetir nova senha').props.onChangeText('Nova@1234');
    });
  };

  it('envia senha atual e nova pro backend e volta no sucesso', async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const tree = await render();
    await preenche(tree);

    await act(async () => {
      await botao(tree, 'Salvar nova senha').props.onPress();
    });

    expect(mockChangePassword).toHaveBeenCalledWith({
      currentPassword: 'velha123',
      newPassword: 'Nova@1234',
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it('mostra o erro do backend e não sai da tela quando a troca falha', async () => {
    mockChangePassword.mockRejectedValue(new Error('Senha atual incorreta'));
    const tree = await render();
    await preenche(tree);

    await act(async () => {
      await botao(tree, 'Salvar nova senha').props.onPress();
    });

    expect(mockBack).not.toHaveBeenCalled();
    const erro = tree.root.findAll(
      (n) => n.props?.variant === 'error' && n.props?.title === 'Senha atual incorreta',
    );
    expect(erro.length).toBeGreaterThan(0);
  });
});

// O handleSave marca os campos como tocados pra revelar o erro de cada um, mas
// `disabled={!canSubmit}` impediria o onPress de chegar lá: o bloco vira
// código morto e o toque some no vazio.
//
// A asserção de `disabled` é o coração do teste, e é sutil: o DS faz
// `onPress={disabled ? undefined : onPress}` no Pressable interno, então
// chamar onPress() do elemento externo CONTORNA o disabled e passaria mesmo
// com a regressão presente. Sem ela o teste não tem dente.
describe('alterar senha: Salvar com formulário incompleto', () => {
  it('mantém o botão habilitado para que o toque chegue à validação', async () => {
    const tree = await render();
    expect(botao(tree, 'Salvar nova senha').props.disabled).toBeFalsy();
  });

  it('revela o erro dos campos obrigatórios em vez de engolir o toque', async () => {
    const tree = await render();
    expect(field(tree, 'Senha atual').props.description).toBeFalsy();

    await act(async () => {
      await botao(tree, 'Salvar nova senha').props.onPress();
    });

    expect(field(tree, 'Senha atual').props.descriptionVariant).toBe('error');
    expect(field(tree, 'Senha atual').props.description).toBeTruthy();
    expect(field(tree, 'Nova senha').props.descriptionVariant).toBe('error');
  });

  it('continua NÃO salvando enquanto o formulário está inválido', async () => {
    const tree = await render();

    await act(async () => {
      await botao(tree, 'Salvar nova senha').props.onPress();
    });

    expect(mockBack).not.toHaveBeenCalled();
  });
});
