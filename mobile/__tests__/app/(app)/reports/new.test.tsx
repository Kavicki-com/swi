import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import NovoRelatorio from '../../../../app/(app)/reports/new';
import { useMediaPicker } from '../../../../lib/media/useMediaPicker';
import { useReports } from '../../../../services/reports/ReportsProvider';

jest.mock('../../../../lib/media/useMediaPicker', () => ({ useMediaPicker: jest.fn() }));
jest.mock('../../../../services/reports/ReportsProvider', () => ({ useReports: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

const mockUseMediaPicker = useMediaPicker as jest.Mock;
const mockUseReports = useReports as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const FOTO = 'file:///tmp/foto-1.jpg';

let pickFromGallery: jest.Mock;

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <NovoRelatorio />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// O ImageUploader é o botão "Enviar arquivo": é ele que o usuário toca.
const uploader = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => typeof n.props?.onPickFile === 'function')[0];

// A grade de anexos se identifica pelo rótulo de acessibilidade, que muda
// conforme o slot está vazio ou preenchido.
const slotVazio = (tree: ReturnType<typeof create>, i: number) =>
  tree.root.findAll((n) => n.props?.accessibilityLabel === `Adicionar anexo ${i}`).length > 0;

const slotPreenchido = (tree: ReturnType<typeof create>, i: number) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === `Anexo ${i} (toque para trocar ou remover)`,
  ).length > 0;

const tocarNoSlot = async (tree: ReturnType<typeof create>, rotulo: string) => {
  const slot = tree.root.findAll((n) => n.props?.accessibilityLabel === rotulo)[0];
  await act(async () => { await slot.props.onPress(); });
};

// Campo do form pelo label do DS Input; o save só destrava com os três cheios.
const preencher = async (tree: ReturnType<typeof create>) => {
  for (const label of [
    'Título do relatório',
    'Resumo do relatório',
    'Detalhes do relatório',
  ]) {
    const input = tree.root.findAll((n) => n.props?.label === label)[0];
    await act(async () => { input.props.onChangeText('x'); });
  }
};

const botaoSalvar = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.props?.accessibilityLabel === 'Salvar relatório')[0];

const salvar = async (tree: ReturnType<typeof create>) => {
  await act(async () => { await botaoSalvar(tree).props.onPress(); });
};

const campo = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChangeText === 'function',
  )[0];

let showPicker: jest.Mock;
let criarRelatorio: jest.Mock;

beforeEach(() => {
  pickFromGallery = jest.fn(async () => FOTO);
  showPicker = jest.fn(async () => FOTO);
  criarRelatorio = jest.fn(async () => ({}));
  mockUseMediaPicker.mockReturnValue({ showPicker, pickFromGallery });
  mockUseReports.mockReturnValue({ create: criarRelatorio });
});

describe('Novo relatório: anexos', () => {
  // O relato: "quando anexar a imagem, tem que ir pros quadrados da parte de
  // cima onde tem 4 opções e não pra dentro do button que anexa". A tela tinha
  // DOIS estados separados, a grade e o uploader, e o "Enviar arquivo" só
  // alimentava o segundo, então a foto aparecia dentro do próprio botão.
  it('foto escolhida pelo "Enviar arquivo" vai pro primeiro quadrado', async () => {
    const tree = await render();
    expect(slotVazio(tree, 1)).toBe(true);

    await act(async () => { await uploader(tree).props.onPickFile(); });

    expect(slotPreenchido(tree, 1)).toBe(true);
  });

  it('o botão de anexar não guarda preview nenhuma, a foto vive na grade', async () => {
    const tree = await render();
    await act(async () => { await uploader(tree).props.onPickFile(); });
    expect(uploader(tree).props.value).toBeNull();
  });

  it('a segunda foto vai pro próximo quadrado livre, sem sobrescrever a primeira', async () => {
    const tree = await render();
    await act(async () => { await uploader(tree).props.onPickFile(); });
    pickFromGallery.mockResolvedValue('file:///tmp/foto-2.jpg');
    await act(async () => { await uploader(tree).props.onPickFile(); });

    expect(slotPreenchido(tree, 1)).toBe(true);
    expect(slotPreenchido(tree, 2)).toBe(true);
  });

  // Figma 372:21297: a barra fina enche conforme arquivos são adicionados.
  // Estava congelada em 60% desde a fase demo, mentindo o estado da grade.
  it('a barra de progresso enche na proporção dos quadrados preenchidos', async () => {
    const tree = await render();
    const barra = () =>
      tree.root.findAll((n) => n.props?.testID === 'progresso-anexos')[0];
    expect(barra().props.style.width).toBe('0%');

    await act(async () => { await uploader(tree).props.onPickFile(); });
    expect(barra().props.style.width).toBe('25%');

    pickFromGallery.mockResolvedValue('file:///tmp/foto-2.jpg');
    await act(async () => { await uploader(tree).props.onPickFile(); });
    expect(barra().props.style.width).toBe('50%');
  });

  // Sem isso o 5º toque sobrescreveria silenciosamente o primeiro anexo, o
  // usuário perderia uma foto já escolhida sem nenhum aviso.
  it('com os 4 quadrados cheios não abre o seletor', async () => {
    const tree = await render();
    for (const n of [1, 2, 3, 4]) {
      pickFromGallery.mockResolvedValue(`file:///tmp/foto-${n}.jpg`);
      await act(async () => { await uploader(tree).props.onPickFile(); });
    }
    expect(pickFromGallery).toHaveBeenCalledTimes(4);

    await act(async () => { await uploader(tree).props.onPickFile(); });

    expect(pickFromGallery).toHaveBeenCalledTimes(4);
  });
});

// QA Mobile #4: "não é possível remover uma foto já anexada. Ao tocar na
// miniatura só abre o menu Adicionar imagem". Não havia caminho nenhum de
// volta: escolher errado significava salvar com a foto errada.
describe('Novo relatório, remover anexo', () => {
  const anexar = async (tree: ReturnType<typeof create>, uri: string) => {
    pickFromGallery.mockResolvedValue(uri);
    await act(async () => { await uploader(tree).props.onPickFile(); });
  };

  it('quadrado com foto oferece remover no menu', async () => {
    const tree = await render();
    await anexar(tree, FOTO);

    await tocarNoSlot(tree, 'Anexo 1 (toque para trocar ou remover)');

    expect(showPicker).toHaveBeenCalledWith(
      expect.objectContaining({ onRemove: expect.any(Function) }),
    );
  });

  it('quadrado vazio não oferece remover', async () => {
    const tree = await render();

    await tocarNoSlot(tree, 'Adicionar anexo 1');

    expect(showPicker.mock.calls[0][0]?.onRemove).toBeUndefined();
  });

  it('remover esvazia o quadrado e ele volta a aceitar foto', async () => {
    const tree = await render();
    await anexar(tree, FOTO);
    await tocarNoSlot(tree, 'Anexo 1 (toque para trocar ou remover)');

    const { onRemove } = showPicker.mock.calls[0][0];
    await act(async () => { onRemove(); });

    expect(slotPreenchido(tree, 1)).toBe(false);
    expect(slotVazio(tree, 1)).toBe(true);
  });

  // O que o usuário perde se isto quebrar: a foto sai da tela mas sobe assim
  // mesmo, e ele só descobre com o relatório publicado.
  it('a foto removida não vai no relatório salvo', async () => {
    const tree = await render();
    await anexar(tree, FOTO);
    await anexar(tree, 'file:///tmp/foto-2.jpg');
    await tocarNoSlot(tree, 'Anexo 1 (toque para trocar ou remover)');

    const { onRemove } = showPicker.mock.calls[0][0];
    await act(async () => { onRemove(); });

    await preencher(tree);
    await salvar(tree);

    expect(criarRelatorio).toHaveBeenCalledWith(
      expect.objectContaining({ imageUris: ['file:///tmp/foto-2.jpg'] }),
    );
  });

  // Remover o 1º de dois não pode empurrar o 2º pra cima: a pessoa está
  // olhando pra grade e a foto que ela manteve tem que ficar onde estava.
  it('remover um não mexe na posição dos outros', async () => {
    const tree = await render();
    await anexar(tree, FOTO);
    await anexar(tree, 'file:///tmp/foto-2.jpg');
    await tocarNoSlot(tree, 'Anexo 1 (toque para trocar ou remover)');

    const { onRemove } = showPicker.mock.calls[0][0];
    await act(async () => { onRemove(); });

    expect(slotVazio(tree, 1)).toBe(true);
    expect(slotPreenchido(tree, 2)).toBe(true);
  });
});

// Mesma classe de defeito do QA Mobile #1 (corrigido no step-2 em 6ff9c1f e
// encontrada aqui pela varredura): o save já marca os campos como tocados pra
// revelar o erro de cada um, mas `disabled={!canSubmit || saving}` impedia o
// onPress de chegar lá. O bloco era código morto e o toque sumia no vazio.
//
// Aqui a trava de reentrância NÃO pode cair junto: esta tela não usa
// useSubmitOnce, o `saving` é quem impede o segundo toque de criar um
// relatório duplicado. Só o `!canSubmit` sai.
//
// A asserção de `disabled` é o coração do teste, e é sutil: o DS faz
// `onPress={disabled ? undefined : onPress}` no Pressable interno, então
// chamar onPress() do elemento externo CONTORNA o disabled e passaria mesmo
// com o bug de volta. Sem ela o teste não tem dente.
describe('Novo relatório: Salvar com formulário incompleto', () => {
  it('mantém o botão habilitado para que o toque chegue à validação', async () => {
    const tree = await render();
    expect(botaoSalvar(tree).props.disabled).toBeFalsy();
  });

  it('revela o erro dos campos obrigatórios em vez de engolir o toque', async () => {
    const tree = await render();
    expect(campo(tree, 'Título do relatório').props.description).toBeFalsy();

    await salvar(tree);

    expect(campo(tree, 'Título do relatório').props.descriptionVariant).toBe('error');
    expect(campo(tree, 'Título do relatório').props.description).toBeTruthy();
    expect(campo(tree, 'Resumo do relatório').props.descriptionVariant).toBe('error');
    expect(campo(tree, 'Detalhes do relatório').props.descriptionVariant).toBe('error');
  });

  it('continua NÃO criando o relatório enquanto o formulário está inválido', async () => {
    const tree = await render();

    await salvar(tree);

    expect(criarRelatorio).not.toHaveBeenCalled();
  });
});
