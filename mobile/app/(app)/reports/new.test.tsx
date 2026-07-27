import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import NovoRelatorio from './new';
import { useMediaPicker } from '../../../lib/media/useMediaPicker';
import { useReports } from '../../../services/reports/ReportsProvider';

jest.mock('../../../lib/media/useMediaPicker', () => ({ useMediaPicker: jest.fn() }));
jest.mock('../../../services/reports/ReportsProvider', () => ({ useReports: jest.fn() }));
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
    (n) => n.props?.accessibilityLabel === `Anexo ${i} (toque para substituir)`,
  ).length > 0;

beforeEach(() => {
  pickFromGallery = jest.fn(async () => FOTO);
  mockUseMediaPicker.mockReturnValue({
    showPicker: jest.fn(async () => FOTO),
    pickFromGallery,
  });
  mockUseReports.mockReturnValue({ create: jest.fn(async () => ({})) });
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
