import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import WatchConnectionStart from '../../../../app/(onboarding)/watch/connection-start';
import { isFeatureEnabled } from '../../../../lib/featureFlags';
import {
  useWatchDiagnostics,
  type WatchDiagnosticsState,
} from '../../../../services/telemetry/watchDiagnostics';

// Segunda tela do primeiro uso: espera a sessao espelhada ou a primeira
// leitura. Substituiu uma barra que enchia sozinha em 3 segundos e nao
// observava aparelho nenhum.

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, push: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));

jest.mock('../../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: jest.fn(),
}));

// O visualizador baixa um .glb de ~4MB e roda WebGL; tem suite propria.
jest.mock('../../../../components/Smartwatch3D', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Smartwatch3D: (p: Record<string, unknown>) =>
      React.createElement(View, { testID: 'smartwatch-3d', ...p }),
  };
});

const mockGate = isFeatureEnabled as jest.Mock;
const mockEstado = useWatchDiagnostics as jest.MockedFunction<typeof useWatchDiagnostics>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const PRONTO: WatchDiagnosticsState = {
  support: 'ready',
  session: 'none',
  sessionChangedAt: null,
  lastSample: null,
};

const render = async (estado: WatchDiagnosticsState = PRONTO) => {
  mockEstado.mockReturnValue(estado);
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <WatchConnectionStart />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const avancar = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

const FIM = '/(onboarding)/watch/complete';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockGate.mockReturnValue(true);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('primeiro uso, espera do relogio', () => {
  it('atras do portao do primeiro uso', async () => {
    mockGate.mockReturnValue(false);
    const tree = await render();
    expect(mockGate).toHaveBeenCalledWith('watchOnboarding');
    expect(tree.root.findAll((n) => n.props?.testID === 'smartwatch-3d')).toHaveLength(0);
  });

  it('enquanto nada chega, espera sem prometer leitura', async () => {
    const tree = await render();
    await avancar(10_000);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(tree.root.findAll((n) => n.props?.testID === 'smartwatch-3d').length).toBeGreaterThan(0);
  });

  it('a sessao espelhada chegando encerra a espera', async () => {
    const tree = await render();
    await act(async () => {
      mockEstado.mockReturnValue({
        support: 'ready',
        session: 'running',
        sessionChangedAt: '2026-09-02T13:00:00.000Z',
        lastSample: null,
      });
      tree.update(
        <SafeAreaProvider initialMetrics={METRICS}>
          <SwiThemeProvider>
            <WatchConnectionStart />
          </SwiThemeProvider>
        </SafeAreaProvider>,
      );
    });
    expect(mockReplace).toHaveBeenCalledWith(FIM);
  });

  it('a primeira leitura tambem encerra a espera, mesmo sem sessao observada', async () => {
    const tree = await render();
    await act(async () => {
      mockEstado.mockReturnValue({
        support: 'ready',
        session: 'none',
        sessionChangedAt: null,
        lastSample: { bpm: 71, measuredAt: '2026-09-02T13:00:05.000Z' },
      });
      tree.update(
        <SafeAreaProvider initialMetrics={METRICS}>
          <SwiThemeProvider>
            <WatchConnectionStart />
          </SwiThemeProvider>
        </SafeAreaProvider>,
      );
    });
    expect(mockReplace).toHaveBeenCalledWith(FIM);
  });

  // Sem teto, quem nao autorizou ficaria olhando um relogio girando para sempre.
  it('o teto de 30 segundos encerra a espera sozinho', async () => {
    await render();
    await avancar(29_999);
    expect(mockReplace).not.toHaveBeenCalled();
    await avancar(1);
    expect(mockReplace).toHaveBeenCalledWith(FIM);
  });

  it('sem suporte nao espera nada: encerra de imediato', async () => {
    await render({ support: 'unsupported' });
    expect(mockReplace).toHaveBeenCalledWith(FIM);
  });

  it('sair da tela cancela o teto, para nao navegar depois da saida', async () => {
    const agendar = jest.spyOn(globalThis, 'setTimeout');
    const cancelar = jest.spyOn(globalThis, 'clearTimeout');
    const tree = await render();

    const idsDoTeto = agendar.mock.calls
      .map((args, i) => (args[1] === 30_000 ? agendar.mock.results[i].value : undefined))
      .filter((v) => v !== undefined);
    expect(idsDoTeto).toHaveLength(1);

    await act(async () => {
      tree.unmount();
    });
    expect(cancelar).toHaveBeenCalledWith(idsDoTeto[0]);

    await avancar(60_000);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
