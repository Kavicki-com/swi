import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Step3 from '../../../../app/(auth)/complimentary-data/step-3';
import { useProfile } from '../../../../services/profile/ProfileProvider';
import { useAuth } from '../../../../services/auth/AuthProvider';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: mockReplace }),
}));
jest.mock('../../../../services/profile/ProfileProvider', () => ({ useProfile: jest.fn() }));
jest.mock('../../../../services/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
// Gate da smartband desligado: o finish cai no ramo do dashboard, que é o do
// preview/demo. O que se testa aqui é a validação, não o destino.
jest.mock('../../../../lib/featureFlags', () => ({
  isFeatureEnabled: () => false,
  AUTH_BACKEND: 'mock',
}));

const mockUseProfile = useProfile as jest.Mock;
const mockUseAuth = useAuth as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let saveProfile: jest.Mock;

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <Step3 />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// Combobox expõe onChange (não onChangeText, que é do Input).
const combo = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChange === 'function',
  )[0];

const genero = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.props?.testID === 'genero')[0];

const deficiencia = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) => n.props?.label === 'Pessoa com deficiência?' && Array.isArray(n.props?.options),
  )[0];

const botao = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onPress === 'function',
  )[0];

const concluir = async (tree: ReturnType<typeof create>) => {
  await act(async () => {
    await botao(tree, 'Concluir').props.onPress();
  });
};

const preencherTudo = async (tree: ReturnType<typeof create>) => {
  await act(async () => {
    genero(tree).props.onChange('female');
  });
  await act(async () => {
    combo(tree, 'Altura').props.onChange('170');
  });
  await act(async () => {
    combo(tree, 'Peso').props.onChange('70');
  });
  await act(async () => {
    combo(tree, 'Tipo sanguíneo').props.onChange('O+');
  });
  await act(async () => {
    deficiencia(tree).props.onChange('nao');
  });
};

beforeEach(() => {
  mockReplace.mockClear();
  saveProfile = jest.fn().mockResolvedValue(undefined);
  mockUseProfile.mockReturnValue({ profile: null, saveProfile });
  mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'worker@exemplo.test', name: 'Worker' } });
});

// QA Mobile #1 foi reportado na etapa 2, e a etapa 2 foi corrigida em 6ff9c1f.
// A varredura da classe achou a MESMA parede aqui, um passo adiante e pior: o
// `finish` fazia `if (!canSubmit) return;` seco, sem nem o bloco de setTouched
// que o step-2 tinha. Não havia superfície de erro nenhuma, porque os campos
// são Combobox / GenderSelector / Radio, e nenhum deles tinha legenda com
// variante antes do DS 0.1.131.
//
// É a última porta antes do dashboard: quem esbarrava aqui não terminava o
// cadastro.
describe('step-3: Concluir com formulário incompleto', () => {
  // Esta asserção é o coração do teste, e é sutil: o DS faz
  // `onPress={disabled ? undefined : onPress}` no Pressable interno, então
  // chamar onPress() do elemento externo CONTORNA o disabled e passaria mesmo
  // com o bug de volta.
  it('mantém o botão habilitado para que o toque chegue à validação', async () => {
    const tree = await render();
    expect(botao(tree, 'Concluir').props.disabled).toBeFalsy();
  });

  it('pristine não acusa nada', async () => {
    const tree = await render();
    expect(genero(tree).props.description).toBeFalsy();
    expect(combo(tree, 'Altura').props.description).toBeFalsy();
    expect(deficiencia(tree).props.description).toBeFalsy();
  });

  it('revela o que falta em CADA campo obrigatório', async () => {
    const tree = await render();

    await concluir(tree);

    for (const node of [
      genero(tree),
      combo(tree, 'Altura'),
      combo(tree, 'Peso'),
      combo(tree, 'Tipo sanguíneo'),
      deficiencia(tree),
    ]) {
      expect(node.props.description).toBeTruthy();
      expect(node.props.descriptionVariant).toBe('error');
    }
  });

  // Allergies e chronic conditions são opcionais de propósito (não é incomum
  // não ter). Acusá-los faria a pessoa procurar um erro que não existe.
  it('não acusa os campos opcionais', async () => {
    const tree = await render();

    await concluir(tree);

    const opcionais = tree.root.findAll(
      (n) =>
        (n.props?.label === 'Possui alergias?' ||
          n.props?.label === 'Possui doenças crônicas?') &&
        typeof n.props?.onChangeText === 'function',
    );
    expect(opcionais.length).toBeGreaterThan(0);
    for (const node of opcionais) expect(node.props.description).toBeFalsy();
  });

  it('continua NÃO concluindo enquanto o formulário está inválido', async () => {
    const tree = await render();

    await concluir(tree);

    expect(saveProfile).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // O outro lado da moeda: habilitar o botão não pode ter afrouxado nada, e o
  // formulário completo tem que continuar salvando e navegando.
  it('com tudo preenchido salva e sai do wizard', async () => {
    const tree = await render();

    await preencherTudo(tree);
    await concluir(tree);

    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        gender: 'female',
        bloodType: 'O+',
        heightCm: 170,
        weightKg: 70,
        hasDisability: false,
      }),
    );
    expect(mockReplace).toHaveBeenCalledWith('/(app)/dashboard');
  });

  // Preencher depois do erro tem que apagar a mensagem daquele campo, senão a
  // tela continua vermelha e a pessoa não sabe que já resolveu.
  it('preencher um campo apaga o erro dele', async () => {
    const tree = await render();
    await concluir(tree);
    expect(combo(tree, 'Altura').props.description).toBeTruthy();

    await act(async () => {
      combo(tree, 'Altura').props.onChange('170');
    });

    expect(combo(tree, 'Altura').props.description).toBeFalsy();
    // E o que continua faltando segue acusado.
    expect(combo(tree, 'Peso').props.description).toBeTruthy();
  });
});
