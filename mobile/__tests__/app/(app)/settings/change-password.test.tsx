import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SettingsChangePassword from '../../../../app/(app)/settings/change-password';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
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
});

// Mesma classe de defeito do QA Mobile #1 (corrigido no step-2 em 6ff9c1f e
// encontrado aqui pela varredura): o handleSave já marca os campos como
// tocados pra revelar o erro de cada um, mas `disabled={!canSubmit}` impedia
// o onPress de chegar lá. O bloco era código morto e o toque sumia no vazio.
//
// A asserção de `disabled` é o coração do teste, e é sutil: o DS faz
// `onPress={disabled ? undefined : onPress}` no Pressable interno, então
// chamar onPress() do elemento externo CONTORNA o disabled e passaria mesmo
// com o bug de volta. Sem ela o teste não tem dente.
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
