import { act, create } from 'react-test-renderer';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SettingsPreferences from '../../../../app/(app)/settings/preferences';

// Notificações e Ligações telefônicas não têm permissão que o app consiga
// pedir ou ler por conta própria. Como os outros toggles da tela fazem ao
// desligar, os dois levam aos Ajustes do sistema, onde a pessoa decide.

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: async () => ({ granted: true }),
  requestForegroundPermissionsAsync: async () => ({ granted: true }),
}));
jest.mock('expo-image-picker', () => ({
  getMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
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
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
});
afterEach(() => openSettings.mockRestore());

describe.each(['Notificações', 'Ligações telefônicas'])('Preferências: %s', (label) => {
  it.each([false, true])('alternar para %s abre os Ajustes do sistema', async (ligar) => {
    const tree = await render();
    const antes = toggle(tree, label).props.value;

    await act(async () => { await toggle(tree, label).props.onChange(ligar); });

    expect(openSettings).toHaveBeenCalledTimes(1);
    // O valor não muda sozinho: quem decide é a tela de Ajustes.
    expect(toggle(tree, label).props.value).toBe(antes);
  });
});
