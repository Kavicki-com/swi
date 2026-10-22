import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider, Toast } from '@kavicki/swi-design-system';
import SettingsChangePassword from '../../../../app/(app)/settings/change-password';

// Trocar senha: a pessoa vê que deu certo ("Senha alterada.") antes de a tela
// voltar, e o botão não deixa a troca sair duas vezes.

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
  await act(async () => {
    const campo = (label: string) =>
      tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onChangeText === 'function')[0];
    campo('Senha atual').props.onChangeText('velha123');
    campo('Nova senha').props.onChangeText('Nova@1234');
    campo('Repetir nova senha').props.onChangeText('Nova@1234');
  });
  return tree;
};

const salvar = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) => n.props?.label === 'Salvar nova senha' && typeof n.props?.onPress === 'function',
  )[0];

const sucesso = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(Toast).filter((t) => t.props.variant === 'success');

beforeEach(() => {
  jest.useFakeTimers();
  mockBack.mockClear();
  mockChangePassword.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('Trocar senha: aviso de sucesso', () => {
  it('mostra "Senha alterada." e só volta depois do aviso', async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const tree = await render();

    await act(async () => { await salvar(tree).props.onPress(); });

    expect(sucesso(tree).map((t) => t.props.title)).toEqual(['Senha alterada.']);
    expect(mockBack).not.toHaveBeenCalled();

    await act(async () => { jest.runOnlyPendingTimers(); });

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('sair da tela antes do prazo não faz a volta disparar depois', async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const tree = await render();
    await act(async () => { await salvar(tree).props.onPress(); });

    act(() => tree.unmount());
    jest.runOnlyPendingTimers();

    expect(mockBack).not.toHaveBeenCalled();
  });

  it('falha não mostra o aviso de sucesso nem volta', async () => {
    mockChangePassword.mockRejectedValue(new Error('Senha atual incorreta'));
    const tree = await render();

    await act(async () => { await salvar(tree).props.onPress(); });
    await act(async () => { jest.runOnlyPendingTimers(); });

    expect(sucesso(tree)).toHaveLength(0);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('Trocar senha: trava contra toque duplo', () => {
  it('dois toques seguidos enviam a troca uma vez só', async () => {
    let concluir!: () => void;
    mockChangePassword.mockReturnValue(new Promise<void>((r) => { concluir = r; }));
    const tree = await render();

    await act(async () => {
      void salvar(tree).props.onPress();
      void salvar(tree).props.onPress();
    });

    expect(mockChangePassword).toHaveBeenCalledTimes(1);
    await act(async () => { concluir(); });
  });

  it('o botão fica travado enquanto salva', async () => {
    let concluir!: () => void;
    mockChangePassword.mockReturnValue(new Promise<void>((r) => { concluir = r; }));
    const tree = await render();

    await act(async () => { void salvar(tree).props.onPress(); });

    expect(salvar(tree).props.disabled).toBe(true);
    await act(async () => { concluir(); });
  });

  // Entre o sucesso e a volta a troca já foi feita: um novo toque mandaria a
  // senha antiga, que não vale mais, e mostraria um erro falso.
  it('depois do sucesso o botão segue travado até a tela voltar', async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const tree = await render();

    await act(async () => { await salvar(tree).props.onPress(); });

    expect(salvar(tree).props.disabled).toBe(true);
  });

  it('depois de uma falha o botão destrava para tentar de novo', async () => {
    mockChangePassword.mockRejectedValue(new Error('Senha atual incorreta'));
    const tree = await render();

    await act(async () => { await salvar(tree).props.onPress(); });

    expect(salvar(tree).props.disabled).toBeFalsy();
  });
});
