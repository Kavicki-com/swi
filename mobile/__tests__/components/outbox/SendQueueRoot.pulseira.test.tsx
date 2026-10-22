import { act, create } from 'react-test-renderer';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider, Toast } from '@kavicki/swi-design-system';
import { SendQueueRoot } from '../../../components/outbox/SendQueueRoot';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import type { MyTelemetryState } from '../../../services/vitals/MyTelemetryProvider';
import { reporting } from '../../../services/telemetry/myTelemetryFixtures';

// O aviso de bateria baixa por cima de qualquer tela fala do aparelho que a
// pessoa usa: a pulseira no Android (o caminho do Health Connect), o relógio
// no iPhone. O mesmo critério das outras telas que já distinguem os dois.

jest.mock('../../../services/outbox/useSendQueue', () => ({
  useSendQueueSession: () => undefined,
  useSendQueueEvent: () => undefined,
  useSendQueueState: () => ({ items: [], refused: [], open: true, stalled: false }),
}));
jest.mock('../../../services/realtime/useConnection', () => ({
  useConnectionLost: () => false,
}));
let mockTelemetry: MyTelemetryState = { telemetry: null, failed: false, loading: false };
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => mockTelemetry,
}));
jest.mock('../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));
const mockGate = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const avisoDeBateria = () => {
  mockTelemetry = {
    telemetry: {
      ...reporting(),
      conditions: [
        {
          kind: 'DEVICE_BATTERY_LOW',
          category: 'DEVICE' as const,
          openedAt: '2026-10-05T12:00:00.000Z',
          observedValue: 12,
          thresholdValue: 15,
        },
      ],
    },
    failed: false,
    loading: false,
  };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <SendQueueRoot userId="u1" />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  const toast = tree.root.findAllByType(Toast)[0];
  return { title: toast.props.title, message: toast.props.message };
};

beforeEach(() => {
  mockGate.mockImplementation((flag) => flag === 'healthConnect');
});
afterEach(() => naPlataforma(originalOS));

describe('SendQueueRoot: bateria baixa por aparelho', () => {
  it('no Android fala da pulseira', () => {
    naPlataforma('android');

    expect(avisoDeBateria()).toEqual({
      title: 'Bateria da pulseira baixa',
      message: 'Bateria em 12%. Carregue a pulseira para seguir monitorado.',
    });
  });

  it('no iPhone segue falando do relógio', () => {
    naPlataforma('ios');

    expect(avisoDeBateria()).toEqual({
      title: 'Bateria do relógio baixa',
      message: 'Bateria em 12%. Carregue o relógio para seguir monitorado.',
    });
  });

  // Fora da build de produção o Android não lê a pulseira (o portão do Health
  // Connect fica desligado), igual às outras telas.
  it('no Android sem o portão do Health Connect, relógio', () => {
    naPlataforma('android');
    mockGate.mockReturnValue(false);

    expect(avisoDeBateria().title).toBe('Bateria do relógio baixa');
  });
});
