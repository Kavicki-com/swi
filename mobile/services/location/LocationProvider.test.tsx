// A posição do aparelho. O que este teste trava: sem leitura do GPS a posição
// é NULA. O provider já devolveu um ponto fixo de São Paulo nesses casos, e
// esse ponto ia parar no mapa e na telemetria como se fosse medido.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LocationProvider, useLocation } from './LocationProvider';
import type { LocationState } from './types';

const mockRequest = jest.fn();
const mockWatch = jest.fn();
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: () => mockRequest(),
  watchPositionAsync: (opts: unknown, cb: unknown) => mockWatch(opts, cb),
}));

let seen: LocationState;
function Probe() {
  seen = useLocation();
  return null;
}

const mount = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <LocationProvider>
        <Probe />
      </LocationProvider>,
    );
  });
  return tree;
};

type Fix = (pos: { coords: { longitude: number; latitude: number } }) => void;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockRequest.mockResolvedValue({ status: 'granted' });
  mockWatch.mockResolvedValue({ remove });
});

describe('LocationProvider', () => {
  it('antes de a permissão responder, não há posição', async () => {
    mockRequest.mockReturnValue(new Promise(() => {}));
    await mount();

    expect(seen).toEqual({ coords: null, permission: 'undetermined' });
  });

  it('permissão negada: posição nula e nenhuma escuta do GPS', async () => {
    mockRequest.mockResolvedValue({ status: 'denied' });
    await mount();

    expect(seen).toEqual({ coords: null, permission: 'denied' });
    expect(mockWatch).not.toHaveBeenCalled();
  });

  it('permissão concedida e sem leitura ainda: posição nula', async () => {
    await mount();

    expect(seen).toEqual({ coords: null, permission: 'granted' });
    expect(mockWatch).toHaveBeenCalledTimes(1);
  });

  it('a leitura do GPS vira a posição, em [longitude, latitude]', async () => {
    await mount();
    const onFix = mockWatch.mock.calls[0][1] as Fix;

    await act(async () => {
      onFix({ coords: { longitude: -43.9, latitude: -19.9 } });
    });

    expect(seen).toEqual({ coords: [-43.9, -19.9], permission: 'granted' });
  });

  it('aparelho sem geolocalização: posição nula, permissão negada', async () => {
    mockRequest.mockRejectedValue(new Error('indisponível'));
    await mount();

    expect(seen).toEqual({ coords: null, permission: 'denied' });
  });

  it('ao sair, encerra a escuta do GPS', async () => {
    const tree = await mount();

    await act(async () => {
      tree.unmount();
    });

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('saiu antes de a escuta começar: encerra assim que ela chega', async () => {
    let entregar!: (sub: { remove: () => void }) => void;
    mockWatch.mockReturnValue(new Promise((resolve) => (entregar = resolve)));
    const tree = await mount();

    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      entregar({ remove });
    });

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('useLocation fora do provider é erro de programação', () => {
    const calado = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      act(() => {
        create(<Probe />);
      }),
    ).toThrow('useLocation must be used inside LocationProvider');
    calado.mockRestore();
  });
});
