import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { LiveSelfView } from '../../components/LiveSelfView.native';

// O self-view lê o estado da transmissão; aqui o mockHook é dublado para controlar
// "no ar" e a URL do stream. O RTCView é o dublê de __mocks__.
const mockHook = {
  broadcasting: false,
  previewUrl: null as string | null,
  live: false,
  notice: null as string | null,
  toggle: jest.fn(),
  dismissNotice: jest.fn(),
};
jest.mock('../../services/live/useLiveBroadcast', () => ({
  useLiveBroadcast: () => mockHook,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <LiveSelfView />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

beforeEach(() => {
  mockHook.broadcasting = false;
  mockHook.previewUrl = null;
  mockHook.toggle.mockClear();
});

describe('LiveSelfView', () => {
  it('fora do ar, não mostra nada', async () => {
    const tree = await render();
    expect(tree.root.findAllByType(RTCView)).toHaveLength(0);
  });

  it('sem URL de preview, não mostra nada mesmo no ar', async () => {
    mockHook.broadcasting = true;
    mockHook.previewUrl = null;
    const tree = await render();
    expect(tree.root.findAllByType(RTCView)).toHaveLength(0);
  });

  it('no ar, desenha a câmera local com a URL do stream', async () => {
    mockHook.broadcasting = true;
    mockHook.previewUrl = 'rtc://local';
    const tree = await render();
    const views = tree.root.findAllByType(RTCView);
    expect(views).toHaveLength(1);
    expect(views[0].props.streamURL).toBe('rtc://local');
  });

  it('tocar na miniatura encerra a transmissão', async () => {
    mockHook.broadcasting = true;
    mockHook.previewUrl = 'rtc://local';
    const tree = await render();
    const botao = tree.root.findAll(
      (n) =>
        n.props?.accessibilityLabel === 'Encerrar transmissão da câmera' &&
        typeof n.props?.onPress === 'function',
    )[0];
    await act(async () => botao.props.onPress());
    expect(mockHook.toggle).toHaveBeenCalledTimes(1);
  });
});
