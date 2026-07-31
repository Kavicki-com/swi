import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import * as ImagePicker from 'expo-image-picker';
import NovoRelatorio from '../../../../app/(app)/reports/new';
import { useReports } from '../../../../services/reports/ReportsProvider';

// O QUE ESTE ARQUIVO COBRE, e o new.test.tsx nao:
//
// La o useMediaPicker e mockado, entao tela e hook sao verificados cada um
// contra a ideia que o teste tem do outro. Se as duas pontas discordassem (a
// tela mandando `{ onRemove }` e o hook esperando outro formato, por exemplo),
// os dois arquivos passariam e o app estaria quebrado.
//
// Aqui a tela roda com o hook DE VERDADE. So a fronteira nativa e dublada: o
// expo-image-picker (que abriria camera/galeria) e o Alert (que no aparelho
// desenha o action sheet). O teste toca no botao do action sheet REAL, montado
// pelo hook a partir do que a tela pediu.
//
// Isso tambem e a unica verificacao possivel deste menu: no react-native-web o
// Alert e `static alert() {}`, um no-op, entao no browser nao ha o que olhar.

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
jest.mock('../../../../services/reports/ReportsProvider', () => ({ useReports: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const FOTO = 'file:///tmp/foto-1.jpg';

type Botao = { text?: string; style?: string; onPress?: () => void };
const botoesDoMenu = (chamada = 0): Botao[] =>
  (Alert.alert as jest.Mock).mock.calls[chamada][2] ?? [];
const tituloDoMenu = (chamada = 0): string =>
  (Alert.alert as jest.Mock).mock.calls[chamada][0];

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

const porRotulo = (tree: ReturnType<typeof create>, rotulo: string) =>
  tree.root.findAll((n) => n.props?.accessibilityLabel === rotulo);

// O rotulo aparece no Pressable e tambem nos nos hospedeiros que ele renderiza,
// entao a pergunta util e "existe?", nao "quantos?".
const existe = (tree: ReturnType<typeof create>, rotulo: string) =>
  porRotulo(tree, rotulo).length > 0;

// NAO da pra esperar o onPress: ele so resolve quando o usuario escolhe algo no
// action sheet, e quem escolhe e o proprio teste, logo abaixo. Aguardar aqui
// trava. Dispara e deixa pendente, que e exatamente o estado do app com o menu
// aberto na tela.
const tocar = async (tree: ReturnType<typeof create>, rotulo: string) => {
  await act(async () => {
    void porRotulo(tree, rotulo)[0].props.onPress();
  });
};

const anexarPeloUploader = async (tree: ReturnType<typeof create>) => {
  const uploader = tree.root.findAll((n) => typeof n.props?.onPickFile === 'function')[0];
  await act(async () => { await uploader.props.onPickFile(); });
  return uploader;
};

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: FOTO }],
  });
  (useReports as jest.Mock).mockReturnValue({ create: jest.fn(async () => ({})) });
});
afterEach(() => jest.restoreAllMocks());

describe('Novo relatório, anexo de ponta a ponta (tela + hook reais)', () => {
  it('slot vazio: o menu do aparelho não oferece remover', async () => {
    const tree = await render();

    await tocar(tree, 'Adicionar anexo 1');

    expect(tituloDoMenu()).toBe('Adicionar imagem');
    expect(botoesDoMenu().map((b) => b.text)).toEqual([
      'Tirar foto',
      'Escolher da galeria',
      'Cancelar',
    ]);
  });

  // O caminho exato do QA Mobile #4: anexa, toca na miniatura, toca em remover.
  it('slot com foto: o menu oferece remover, e remover esvazia o quadrado', async () => {
    const tree = await render();
    await anexarPeloUploader(tree);
    expect(existe(tree, 'Anexo 1 (toque para trocar ou remover)')).toBe(true);

    await tocar(tree, 'Anexo 1 (toque para trocar ou remover)');
    const botoes = botoesDoMenu();
    // Com foto, o menu troca ou remove; nao adiciona nada.
    expect(tituloDoMenu()).toBe('Alterar imagem');
    expect(botoes.map((b) => b.text)).toEqual([
      'Tirar foto',
      'Escolher da galeria',
      'Remover foto',
      'Cancelar',
    ]);

    // Toca no botão do action sheet, como o dedo do usuário faria.
    await act(async () => {
      botoes.find((b) => b.text === 'Remover foto')!.onPress!();
    });

    expect(existe(tree, 'Anexo 1 (toque para trocar ou remover)')).toBe(false);
    expect(existe(tree, 'Adicionar anexo 1')).toBe(true);
  });

  it('depois de remover, o mesmo quadrado aceita uma foto nova', async () => {
    const tree = await render();
    const uploader = await anexarPeloUploader(tree);

    await tocar(tree, 'Anexo 1 (toque para trocar ou remover)');
    await act(async () => {
      botoesDoMenu().find((b) => b.text === 'Remover foto')!.onPress!();
    });

    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/foto-2.jpg' }],
    });
    await act(async () => { await uploader.props.onPickFile(); });

    expect(existe(tree, 'Anexo 1 (toque para trocar ou remover)')).toBe(true);
  });

  it('cancelar o menu não mexe na foto anexada', async () => {
    const tree = await render();
    await anexarPeloUploader(tree);

    await tocar(tree, 'Anexo 1 (toque para trocar ou remover)');
    await act(async () => {
      botoesDoMenu().find((b) => b.text === 'Cancelar')!.onPress!();
    });

    expect(existe(tree, 'Anexo 1 (toque para trocar ou remover)')).toBe(true);
  });
});
