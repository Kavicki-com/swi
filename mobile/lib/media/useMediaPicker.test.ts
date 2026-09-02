import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useMediaPicker, type UseMediaPickerReturn } from './useMediaPicker';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

const FOTO = 'file:///tmp/foto.jpg';

// Hook precisa de um renderer pra ter dispatcher; uma sonda sem UI basta e
// devolve exatamente o objeto que uma tela receberia.
const picker = (): UseMediaPickerReturn => {
  let api!: UseMediaPickerReturn;
  const Sonda = () => {
    api = useMediaPicker();
    return null;
  };
  act(() => {
    create(createElement(Sonda));
  });
  return api;
};

// Botões do Alert.alert por rótulo, pra o teste "tocar" no que o usuário toca.
type Botao = { text?: string; style?: string; onPress?: () => void };
const botoes = (): Botao[] => (Alert.alert as jest.Mock).mock.calls[0][2] ?? [];
const botao = (texto: string) => botoes().find((b) => b.text === texto);

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: FOTO }],
  });
});
afterEach(() => jest.restoreAllMocks());

const titulo = (): string => (Alert.alert as jest.Mock).mock.calls[0][0];

describe('useMediaPicker.showPicker', () => {
  // Com foto já escolhida o menu não adiciona nada: ele troca ou remove. Manter
  // "Adicionar imagem" ali contradiz as opções que o próprio menu oferece.
  it('slot vazio: o título é "Adicionar imagem"', () => {
    void picker().showPicker();
    expect(titulo()).toBe('Adicionar imagem');
  });

  it('com foto (onRemove): o título é "Alterar imagem"', () => {
    void picker().showPicker({ onRemove: jest.fn() });
    expect(titulo()).toBe('Alterar imagem');
  });

  it('sem onRemove o menu é o de sempre: tirar, escolher, cancelar', () => {
    void picker().showPicker();
    expect(botoes().map((b) => b.text)).toEqual([
      'Tirar foto',
      'Escolher da galeria',
      'Cancelar',
    ]);
  });

  // Quem chama informa se há imagem removível; slots vazios não exibem a opção.
  it('com onRemove o menu ganha "Remover foto" antes de Cancelar', () => {
    void picker().showPicker({ onRemove: jest.fn() });
    expect(botoes().map((b) => b.text)).toEqual([
      'Tirar foto',
      'Escolher da galeria',
      'Remover foto',
      'Cancelar',
    ]);
  });

  it('"Remover foto" é destrutivo (vermelho no iOS)', () => {
    void picker().showPicker({ onRemove: jest.fn() });
    expect(botao('Remover foto')?.style).toBe('destructive');
  });

  it('tocar em "Remover foto" chama o onRemove e resolve sem uri', async () => {
    const onRemove = jest.fn();
    const p = picker().showPicker({ onRemove });

    botao('Remover foto')!.onPress!();

    await expect(p).resolves.toBeNull();
    expect(onRemove).toHaveBeenCalledTimes(1);
    // Remover não pode abrir câmera nem galeria de tabela.
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('cancelar não remove nada', async () => {
    const onRemove = jest.fn();
    const p = picker().showPicker({ onRemove });

    botao('Cancelar')!.onPress!();

    await expect(p).resolves.toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('escolher da galeria segue devolvendo a uri, mesmo com onRemove', async () => {
    const onRemove = jest.fn();
    const p = picker().showPicker({ onRemove });

    botao('Escolher da galeria')!.onPress!();

    await expect(p).resolves.toBe(FOTO);
    expect(onRemove).not.toHaveBeenCalled();
  });
});

// Ticket 17: o que a galeria devolve passa pela régua de mídia ANTES de chegar
// ao caller: formato fora da lista ou arquivo acima do teto viram aviso claro
// + null, o mesmo contrato de cancelamento que os callers já tratam.
describe('useMediaPicker: validação do arquivo escolhido', () => {
  it('formato não suportado avisa e resolve null', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/anim.gif', fileSize: 1024 }],
    });

    const uri = await picker().pickFromGallery();

    expect(uri).toBeNull();
    const chamadas = (Alert.alert as jest.Mock).mock.calls;
    expect(chamadas[chamadas.length - 1][1]).toMatch(/JPG ou PNG/);
  });

  it('arquivo acima de 15 MB avisa e resolve null', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/foto.jpg', fileSize: 16 * 1024 * 1024 }],
    });

    const uri = await picker().pickFromGallery();

    expect(uri).toBeNull();
    const chamadas = (Alert.alert as jest.Mock).mock.calls;
    expect(chamadas[chamadas.length - 1][1]).toMatch(/15 MB/);
  });

  it('arquivo válido segue passando direto', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: FOTO, fileSize: 1024 }],
    });

    expect(await picker().pickFromGallery()).toBe(FOTO);
  });
});
