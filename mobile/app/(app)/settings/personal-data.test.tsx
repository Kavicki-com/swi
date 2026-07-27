import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SettingsPersonalData from './personal-data';
import { useProfile } from '../../../services/profile/ProfileProvider';
import { fetchProfileCatalog } from '../../../services/api/catalog';

jest.mock('../../../services/profile/ProfileProvider', () => ({ useProfile: jest.fn() }));
jest.mock('../../../services/api/catalog', () => ({ fetchProfileCatalog: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

const mockUseProfile = useProfile as jest.Mock;
const mockCatalog = fetchProfileCatalog as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// CPF sintético com dígitos verificadores válidos (não pertence a ninguém).
const CPF_VALIDO = '52998224725';

let saveProfile: jest.Mock;

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <SettingsPersonalData />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// A tela é montada de verdade; o alvo é o <Input> do DS identificado pelo
// label visível — é assim que o usuário o encontra, e sobrevive a remanejo
// de layout.
const field = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChangeText === 'function',
  )[0];

const type = async (tree: ReturnType<typeof create>, label: string, text: string) => {
  await act(async () => { field(tree, label).props.onChangeText(text); });
};

const valueOf = (tree: ReturnType<typeof create>, label: string) => field(tree, label).props.value;

const press = async (tree: ReturnType<typeof create>, label: string) => {
  const btn = tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onPress === 'function',
  )[0];
  await act(async () => { btn.props.onPress(); });
};

beforeEach(() => {
  saveProfile = jest.fn(async () => ({}));
  mockUseProfile.mockReturnValue({ loadProfile: jest.fn(async () => null), saveProfile });
  mockCatalog.mockResolvedValue({ jobTitles: [], sectors: [], duties: [] });
});

describe('Dados pessoais — máscara de entrada', () => {
  // O relato: digitando a data de nascimento as barras não apareciam, e o
  // campo aceitava 02011999 (print do QA no aparelho, 2026-07-27). As
  // máscaras já existiam em lib/validation/masks.ts e estavam ligadas só no
  // cadastro; esta tela ficou com useState cru.
  it('formata a data de nascimento enquanto digita', async () => {
    const tree = await render();
    await type(tree, 'Data de Nascimento', '02011999');
    expect(valueOf(tree, 'Data de Nascimento')).toBe('02/01/1999');
  });

  it('formata o CPF enquanto digita', async () => {
    const tree = await render();
    await type(tree, 'CPF', CPF_VALIDO);
    expect(valueOf(tree, 'CPF')).toBe('529.982.247-25');
  });

  it('formata o telefone enquanto digita', async () => {
    const tree = await render();
    await type(tree, 'Telefone', '41999990000');
    expect(valueOf(tree, 'Telefone')).toBe('(41) 99999-0000');
  });

  it('UF aceita só letras e sobe pra maiúscula', async () => {
    const tree = await render();
    await type(tree, 'UF', 'pr1');
    expect(valueOf(tree, 'UF')).toBe('PR');
  });
});

describe('Dados pessoais — validação', () => {
  const preencherTudoValido = async (tree: ReturnType<typeof create>) => {
    await type(tree, 'Nome Completo', 'Fulano de Tal');
    await type(tree, 'Data de Nascimento', '02011999');
    await type(tree, 'CPF', CPF_VALIDO);
    await type(tree, 'Email', 'fulano@empresa.com');
    await type(tree, 'Telefone', '41999990000');
    await type(tree, 'UF', 'PR');
    await type(tree, 'Cidade', 'Curitiba');
  };

  it('não salva com CPF inválido', async () => {
    const tree = await render();
    await preencherTudoValido(tree);
    await type(tree, 'CPF', '11111111111'); // 11 dígitos iguais — inválido
    await press(tree, 'Salvar alterações');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('não salva com data de nascimento impossível', async () => {
    const tree = await render();
    await preencherTudoValido(tree);
    await type(tree, 'Data de Nascimento', '31022020'); // 31 de fevereiro
    await press(tree, 'Salvar alterações');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('salva quando tudo é válido', async () => {
    const tree = await render();
    await preencherTudoValido(tree);
    await press(tree, 'Salvar alterações');
    expect(saveProfile).toHaveBeenCalledTimes(1);
  });

  // Campo intocado fica quieto: o useField só acusa erro depois do blur, e
  // abrir a tela com tudo vermelho é hostil com quem só veio conferir o
  // cadastro.
  it('campo intocado não mostra erro', async () => {
    const tree = await render();
    expect(field(tree, 'CPF').props.descriptionVariant).not.toBe('error');
  });
});
