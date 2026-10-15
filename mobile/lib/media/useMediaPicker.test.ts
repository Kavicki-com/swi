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

// Anexo multimídia do relatório: a galeria passa a mostrar vídeo junto da
// foto, e o menu ganha a entrada de áudio ou PDF (seletor de documento, que
// quem chama passa). Chat, jornada e avatar não passam nada e seguem iguais.
describe('useMediaPicker: anexo de relatório', () => {
  const pickerComVideo = (): UseMediaPickerReturn => {
    let api!: UseMediaPickerReturn;
    const Sonda = () => {
      api = useMediaPicker({ mediaTypes: ['images', 'videos'] });
      return null;
    };
    act(() => {
      create(createElement(Sonda));
    });
    return api;
  };

  it('por padrão a galeria e a câmera pedem só imagens', async () => {
    await picker().pickFromGallery();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'] }),
    );
  });

  it('com mediaTypes a galeria mostra vídeo; a câmera segue só na foto', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: true });
    const api = pickerComVideo();
    await api.pickFromGallery();
    await api.takePhoto();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images', 'videos'] }),
    );
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'] }),
    );
  });

  it('com onPickDocument o menu vira "anexo" e ganha a entrada de áudio ou PDF', () => {
    void picker().showPicker({ onPickDocument: jest.fn() });
    expect(titulo()).toBe('Adicionar anexo');
    expect(botoes().map((b) => b.text)).toEqual([
      'Tirar foto',
      'Escolher da galeria',
      'Escolher áudio ou PDF',
      'Cancelar',
    ]);
  });

  it('com onPickDocument e onRemove: "Alterar anexo" e "Remover anexo"', () => {
    void picker().showPicker({ onPickDocument: jest.fn(), onRemove: jest.fn() });
    expect(titulo()).toBe('Alterar anexo');
    expect(botoes().map((b) => b.text)).toEqual([
      'Tirar foto',
      'Escolher da galeria',
      'Escolher áudio ou PDF',
      'Remover anexo',
      'Cancelar',
    ]);
  });

  it('tocar em "Escolher áudio ou PDF" resolve com o que o seletor devolver', async () => {
    const onPickDocument = jest.fn(async () => 'file:///cache/laudo.pdf');
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockClear();
    const p = picker().showPicker({ onPickDocument });

    botao('Escolher áudio ou PDF')!.onPress!();

    await expect(p).resolves.toBe('file:///cache/laudo.pdf');
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
});
