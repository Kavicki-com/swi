import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import ChatUserInfo from '../../../../app/(app)/chat/user-info';
import type { Contact } from '../../../../services/chat/types';
import type { Colleague } from '../../../../services/positions/types';

// "Ver câmera" na ficha do colega não fazia nada. O funcionário não assiste a
// transmissão de ninguém (só o painel assiste); o botão abre o mapa geral com
// a camada de câmeras ligada, centrado no colega quando a posição dele chegou.

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({ userId: 'w1' }),
}));

const mockChat = { directory: [] as Contact[] };
jest.mock('../../../../services/chat/ChatProvider', () => ({ useChat: () => mockChat }));

const mockListColleagues = jest.fn();
jest.mock('../../../../services/positions/getPositionsBackend', () => ({
  getPositionsBackend: () => ({ listColleagues: () => mockListColleagues() }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const colega = (id: string, lat: number, lng: number): Colleague => ({
  id,
  name: 'Ana Souza',
  lat,
  lng,
  sector: 'Setor Leste',
  avatar: '',
  recordedAt: '2026-08-06T13:05:00.000Z',
  status: 'good',
});

let montada: ReactTestRenderer | null = null;
const abrir = async () => {
  await act(async () => {
    montada = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <ChatUserInfo />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  // A leitura dos colegas resolve num microtask depois da montagem.
  await act(async () => {
    await Promise.resolve();
  });
  return montada!;
};

const verCamera = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === 'Ver câmera' && typeof n.props?.onPress === 'function',
  )[0];

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockClear();
  mockChat.directory = [
    { workerId: 'w1', name: 'Ana Souza', sector: 'Setor Leste', role: 'Operadora', avatarUri: '' },
  ];
  mockListColleagues.mockReset();
});

afterEach(async () => {
  await act(async () => {
    montada?.unmount();
  });
  montada = null;
  jest.useRealTimers();
});

describe('Ficha do colega: Ver câmera', () => {
  it('abre o mapa geral com as câmeras ligadas, centrado no colega', async () => {
    mockListColleagues.mockResolvedValue([colega('w9', -10, -40), colega('w1', -23.5, -46.6)]);
    const tree = await abrir();

    act(() => verCamera(tree).props.onPress());

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(app)/map',
      params: { cameras: '1', lat: '-23.5', lng: '-46.6' },
    });
  });

  it('sem a posição do colega, abre o mapa com as câmeras ligadas e sem centro', async () => {
    mockListColleagues.mockResolvedValue([colega('w9', -10, -40)]);
    const tree = await abrir();

    act(() => verCamera(tree).props.onPress());

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(app)/map', params: { cameras: '1' } });
  });

  it('com a leitura dos colegas falhando, também abre sem centro', async () => {
    mockListColleagues.mockRejectedValue(new Error('sem rede'));
    const tree = await abrir();

    act(() => verCamera(tree).props.onPress());

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(app)/map', params: { cameras: '1' } });
  });
});
