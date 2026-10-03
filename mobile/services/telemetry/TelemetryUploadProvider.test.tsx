import { act, create } from 'react-test-renderer';
import { isFeatureEnabled } from '../../lib/featureFlags';
import { useAuth } from '../auth/AuthProvider';
import {
  TelemetryUploadProvider,
  useTelemetryUploadState,
  type TelemetryUploadContextValue,
} from './TelemetryUploadProvider';
import { useTelemetryUpload } from './useTelemetryUpload';

// O envio vive na raiz: liga com sessão aberta dentro do piloto, e a tela de
// pareamento avisa quando a credencial nasce.

jest.mock('../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/featureFlags', () => ({ isFeatureEnabled: jest.fn() }));
jest.mock('./useTelemetryUpload', () => ({ useTelemetryUpload: jest.fn() }));

const mockAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockGate = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;
const mockUpload = useTelemetryUpload as jest.MockedFunction<typeof useTelemetryUpload>;

const comUsuario = (user: unknown) =>
  mockAuth.mockReturnValue({ user } as unknown as ReturnType<typeof useAuth>);

let visto: TelemetryUploadContextValue;
function Leitor() {
  visto = useTelemetryUploadState();
  return null;
}

const opcoes = () => mockUpload.mock.calls[mockUpload.mock.calls.length - 1]![2];

async function montar() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <TelemetryUploadProvider>
        <Leitor />
      </TelemetryUploadProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpload.mockReturnValue({ paired: false, lastOutcome: null });
  mockGate.mockReturnValue(true);
  comUsuario({ id: 'w1' });
});

describe('TelemetryUploadProvider', () => {
  it('com sessão aberta e dentro do piloto, o envio fica ligado', async () => {
    await montar();
    expect(mockGate).toHaveBeenCalledWith('appleWatchPilot');
    expect(opcoes()).toEqual({ enabled: true, recheckKey: 0 });
  });

  it('sem sessão o envio fica desligado', async () => {
    comUsuario(null);
    await montar();
    expect(opcoes()).toMatchObject({ enabled: false });
  });

  // Android e builds fora do piloto não têm relógio: nada a enviar.
  it('fora do piloto o envio fica desligado, mesmo com sessão', async () => {
    mockGate.mockReturnValue(false);
    await montar();
    expect(opcoes()).toMatchObject({ enabled: false });
  });

  it('entrega às telas o estado do envio', async () => {
    mockUpload.mockReturnValue({ paired: true, lastOutcome: { outcome: 'idle' } });
    await montar();
    expect(visto.paired).toBe(true);
    expect(visto.lastOutcome).toEqual({ outcome: 'idle' });
  });

  it('avisar o pareamento faz o envio reler a credencial', async () => {
    await montar();
    await act(async () => {
      visto.refreshPairing();
    });
    expect(opcoes()).toEqual({ enabled: true, recheckKey: 1 });
  });

  it('fora do provider a tela lê não pareado, sem quebrar', async () => {
    await act(async () => {
      create(<Leitor />);
    });
    expect(visto.paired).toBe(false);
    expect(() => visto.refreshPairing()).not.toThrow();
  });
});
