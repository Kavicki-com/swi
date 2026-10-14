import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { NavFABs } from '../../components/NavFABs';

// Cluster de FABs do rodapé (Home central + Chat à direita), usado em ~9 telas
// do app. O Home FAB virou o Button do DS (shape pill + diameter, sem o SVG
// local). Estes testes cercam o que não pode regredir na troca: cada FAB leva
// à sua rota, cada um aparece/some pela sua flag, e os rótulos de leitor de
// tela seguem lá (no touch não há tooltip, então o label é a única pista).

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    navigate: mockNavigate,
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
  }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = (props = {}) => {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <NavFABs {...props} />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const porLabel = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label,
  )[0];

beforeEach(() => jest.clearAllMocks());

describe('NavFABs', () => {
  it('o Home FAB leva à dashboard (navigate, não push, para não remontar)', () => {
    const tree = render();
    act(() => porLabel(tree, 'Voltar para a dashboard').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('/(app)/dashboard');
  });

  it('o Chat FAB leva ao inbox', () => {
    const tree = render();
    act(() => porLabel(tree, 'Abrir chat').props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/(app)/chat/inbox');
  });

  it('showHome=false esconde o Home FAB', () => {
    const tree = render({ showHome: false });
    expect(porLabel(tree, 'Voltar para a dashboard')).toBeUndefined();
    expect(porLabel(tree, 'Abrir chat')).toBeDefined();
  });

  it('showChat=false esconde o Chat FAB', () => {
    const tree = render({ showChat: false });
    expect(porLabel(tree, 'Abrir chat')).toBeUndefined();
    expect(porLabel(tree, 'Voltar para a dashboard')).toBeDefined();
  });

  it('handlers custom sobrescrevem a navegação padrão', () => {
    const onHomePress = jest.fn();
    const onChatPress = jest.fn();
    const tree = render({ onHomePress, onChatPress });
    act(() => porLabel(tree, 'Voltar para a dashboard').props.onPress());
    act(() => porLabel(tree, 'Abrir chat').props.onPress());
    expect(onHomePress).toHaveBeenCalledTimes(1);
    expect(onChatPress).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
