import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HorizontalCard, SwiThemeProvider } from '@kavicki/swi-design-system';
import Settings from '../../../../app/(app)/settings/index';
import { isFeatureEnabled } from '../../../../lib/featureFlags';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock('../../../../services/auth/AuthProvider', () => ({
  useAuth: () => ({ signOut: jest.fn() }),
}));
jest.mock('../../../../services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: null }),
}));
jest.mock('../../../../components/HomeFAB', () => ({ HomeFAB: () => null }));
jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));

const mockGate = isFeatureEnabled as jest.Mock;

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
          <Settings />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const rotulos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAllByType(HorizontalCard as React.ComponentType<{ label: string }>)
    .map((c) => c.props.label as string);

// O menu é o mesmo no iPhone e no Android: a tela de Monitoramento é quem
// explica, em cada aparelho, se o relógio lê ou por que não lê. Só a demo
// (Expo Go, prévia web) esconde o item, porque ali nada nativo existe.
describe('Configurações: item Monitoramento', () => {
  it('aparece em qualquer build nativa, inclusive sem o piloto do relógio', async () => {
    mockGate.mockImplementation((gate: string) => gate === 'watchOnboarding');
    expect(rotulos(await render())).toContain('Monitoramento');
  });

  it('some fora de build nativa', async () => {
    mockGate.mockReturnValue(false);
    expect(rotulos(await render())).not.toContain('Monitoramento');
  });
});
