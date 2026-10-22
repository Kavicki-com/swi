import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SettingsHealthData from '../../../../app/(app)/settings/health-data';

// Altura, peso e PcD em Dados de saúde. O cadastro (passo 3) coleta os três e
// depois disso não havia onde corrigir. Aqui eles voltam com os mesmos campos,
// rótulos e validação do cadastro, e salvam pelo mesmo PUT do perfil.

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: jest.fn() }) }));

const mockLoadProfile = jest.fn();
const mockSaveProfile = jest.fn();
jest.mock('../../../../services/profile/ProfileProvider', () => ({
  useProfile: () => ({ loadProfile: mockLoadProfile, saveProfile: mockSaveProfile }),
}));
jest.mock('../../../../services/api/exams', () => ({
  listExams: async () => [],
  createExam: jest.fn(),
}));
jest.mock('../../../../lib/media/pickDocument', () => ({ pickExamDocument: jest.fn() }));

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
          <SettingsHealthData />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// Combobox e RadioGroup do DS: achados pelo rótulo visível.
const escolha = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onChange === 'function')[0];

const escolher = async (tree: ReturnType<typeof create>, label: string, valor: string) => {
  await act(async () => { escolha(tree, label).props.onChange(valor); });
};

const salvar = async (tree: ReturnType<typeof create>) => {
  const botao = tree.root.findAll(
    (n) => n.props?.label === 'Salvar alterações' && typeof n.props?.onPress === 'function',
  )[0];
  await act(async () => { await botao.props.onPress(); });
};

let alerta: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockLoadProfile.mockResolvedValue(null);
  mockSaveProfile.mockResolvedValue({});
});
afterEach(() => alerta.mockRestore());

describe('Dados de saúde: campos do corpo como no cadastro', () => {
  it('tem Altura e Peso com as opções do cadastro', async () => {
    const tree = await render();

    const altura = escolha(tree, 'Altura').props;
    const peso = escolha(tree, 'Peso').props;
    expect(altura.placeholder).toBe('cm');
    expect(altura.options[0]).toEqual({ label: '140 cm', value: '140' });
    expect(altura.options[altura.options.length - 1]).toEqual({ label: '220 cm', value: '220' });
    expect(peso.placeholder).toBe('Kg');
    expect(peso.options[0]).toEqual({ label: '40 kg', value: '40' });
    expect(peso.options[peso.options.length - 1]).toEqual({ label: '160 kg', value: '160' });
  });

  it('tem "Pessoa com deficiência?" com Sim e Não', async () => {
    const tree = await render();

    expect(escolha(tree, 'Pessoa com deficiência?').props.options).toEqual([
      { label: 'Sim', value: 'sim' },
      { label: 'Não', value: 'nao' },
    ]);
  });

  it('abre com o que o cadastro gravou', async () => {
    mockLoadProfile.mockResolvedValue({ heightCm: 172, weightKg: 81, hasDisability: true });
    const tree = await render();

    expect(escolha(tree, 'Altura').props.value).toBe('172');
    expect(escolha(tree, 'Peso').props.value).toBe('81');
    expect(escolha(tree, 'Pessoa com deficiência?').props.value).toBe('sim');
  });

  it('"não" gravado abre marcado como Não, não em branco', async () => {
    mockLoadProfile.mockResolvedValue({ heightCm: 172, weightKg: 81, hasDisability: false });
    const tree = await render();

    expect(escolha(tree, 'Pessoa com deficiência?').props.value).toBe('nao');
  });

  it('só um painel de lista aberto por vez entre Altura e Peso', async () => {
    const tree = await render();

    await act(async () => { escolha(tree, 'Altura').props.onOpenChange(true); });
    await act(async () => { escolha(tree, 'Peso').props.onOpenChange(true); });

    expect(escolha(tree, 'Altura').props.open).toBe(false);
    expect(escolha(tree, 'Peso').props.open).toBe(true);
  });
});

describe('Dados de saúde: salvar altura, peso e PcD', () => {
  it('manda os três no mesmo save do perfil, em número e booleano', async () => {
    mockLoadProfile.mockResolvedValue({ heightCm: 172, weightKg: 81, hasDisability: true });
    const tree = await render();
    await escolher(tree, 'Altura', '180');
    await escolher(tree, 'Peso', '77');
    await escolher(tree, 'Pessoa com deficiência?', 'nao');

    await salvar(tree);

    expect(mockSaveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ heightCm: 180, weightKg: 77, hasDisability: false }),
    );
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  // A mesma regra do cadastro: os três são obrigatórios, e a mensagem só
  // aparece depois do toque em salvar.
  it('em branco, não salva e diz o que falta', async () => {
    const tree = await render();

    expect(escolha(tree, 'Altura').props.description).toBeUndefined();

    await salvar(tree);

    expect(mockSaveProfile).not.toHaveBeenCalled();
    expect(escolha(tree, 'Altura').props).toMatchObject({
      description: 'Altura é obrigatória',
      descriptionVariant: 'error',
    });
    expect(escolha(tree, 'Peso').props).toMatchObject({
      description: 'Peso é obrigatório',
      descriptionVariant: 'error',
    });
    expect(escolha(tree, 'Pessoa com deficiência?').props).toMatchObject({
      description: 'Selecione uma opção',
      descriptionVariant: 'error',
    });
  });

  it('preenchido depois do aviso, a mensagem some e salva', async () => {
    const tree = await render();
    await salvar(tree);

    await escolher(tree, 'Altura', '165');
    await escolher(tree, 'Peso', '60');
    await escolher(tree, 'Pessoa com deficiência?', 'sim');

    expect(escolha(tree, 'Altura').props.description).toBeUndefined();
    await salvar(tree);
    expect(mockSaveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ heightCm: 165, weightKg: 60, hasDisability: true }),
    );
  });
});
