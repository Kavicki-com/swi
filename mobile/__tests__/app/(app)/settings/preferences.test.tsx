import { act, create } from 'react-test-renderer';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SettingsPreferences from '../../../../app/(app)/settings/preferences';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

const mockGetForeground = jest.fn();
const mockRequestForeground = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: () => mockGetForeground(),
  requestForegroundPermissionsAsync: () => mockRequestForeground(),
}));

const mockGetMediaLibrary = jest.fn();
const mockRequestMediaLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  getMediaLibraryPermissionsAsync: () => mockGetMediaLibrary(),
  requestMediaLibraryPermissionsAsync: () => mockRequestMediaLibrary(),
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
          <SettingsPreferences />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const toggle = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onChange === 'function',
  )[0];

let openSettings: jest.SpyInstance;

beforeEach(() => {
  mockGetForeground.mockResolvedValue({ granted: false });
  mockRequestForeground.mockResolvedValue({ granted: true });
  mockGetMediaLibrary.mockResolvedValue({ granted: true });
  mockRequestMediaLibrary.mockResolvedValue({ granted: true });
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
});

afterEach(() => openSettings.mockRestore());

describe('Preferências — toggles espelham permissões reais do SO', () => {
  it('carrega o estado real das permissões na montagem', async () => {
    // Invertido em relação aos defaults antigos da tela de propósito: se a
    // montagem não LER as permissões, este teste pega.
    mockGetForeground.mockResolvedValue({ granted: true });
    mockGetMediaLibrary.mockResolvedValue({ granted: false });
    const tree = await render();
    expect(toggle(tree, 'Localização').props.value).toBe(true);
    expect(toggle(tree, 'Acessar pastas e arquivos').props.value).toBe(false);
  });

  it('ligar Localização pede a permissão e reflete a resposta', async () => {
    const tree = await render();
    await act(async () => { await toggle(tree, 'Localização').props.onChange(true); });
    expect(mockRequestForeground).toHaveBeenCalled();
    expect(toggle(tree, 'Localização').props.value).toBe(true);
  });

  it('permissão negada mantém o toggle desligado', async () => {
    mockRequestForeground.mockResolvedValue({ granted: false });
    const tree = await render();
    await act(async () => { await toggle(tree, 'Localização').props.onChange(true); });
    expect(toggle(tree, 'Localização').props.value).toBe(false);
  });

  it('desligar permissão concedida abre os Ajustes do sistema', async () => {
    const tree = await render();
    await act(async () => { await toggle(tree, 'Acessar pastas e arquivos').props.onChange(false); });
    expect(openSettings).toHaveBeenCalled();
    // O valor não muda por conta própria: revogação só acontece nos Ajustes,
    // e o estado é relido quando o app volta ao foreground.
    expect(toggle(tree, 'Acessar pastas e arquivos').props.value).toBe(true);
  });
});
