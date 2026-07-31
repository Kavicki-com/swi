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

const salvar = async (tree: ReturnType<typeof create>) => {
  const botao = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === 'Salvar relatório',
  )[0];
  await act(async () => { await botao.props.onPress(); });
};

let showPicker: jest.Mock;
let criarRelatorio: jest.Mock;

beforeEach(() => {
  pickFromGallery = jest.fn(async () => FOTO);
  showPicker = jest.fn(async () => FOTO);
  criarRelatorio = jest.fn(async () => ({}));
  mockUseMediaPicker.mockReturnValue({ showPicker, pickFromGallery });
  mockUseReports.mockReturnValue({ create: criarRelatorio });
});

describe('Novo relatório — anexos', () => {
  // O relato: "quando anexar a imagem, tem que ir pros quadrados da parte de
  // cima onde tem 4 opções e não pra dentro do button que anexa". A tela tinha
  // DOIS estados separados — a grade e o uploader — e o "Enviar arquivo" só
  // alimentava o segundo, então a foto aparecia dentro do próprio botão.
  it('foto escolhida pelo "Enviar arquivo" vai pro primeiro quadrado', async () => {
    const tree = await render();
    expect(slotVazio(tree, 1)).toBe(true);

    await act(async () => { await uploader(tree).props.onPickFile(); });

    expect(slotPreenchido(tree, 1)).toBe(true);
  });

  it('o botão de anexar não guarda preview nenhuma — a foto vive na grade', async () => {
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

  // Sem isso o 5º toque sobrescreveria silenciosamente o primeiro anexo — o
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
