import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RadioGroup, SwiThemeProvider } from '@kavicki/swi-design-system';
import { BluetoothHeartRateMonitoring } from '../../../components/telemetry/BluetoothHeartRateMonitoring';
import type {
  BleHeartRate,
  BleHeartRateStatus,
  BleScanResult,
  BleStateChangedEvent,
} from '../../../modules/swi-ble-heart-rate/src';
import {
  createBandChoiceStore,
  type BandChoice,
} from '../../../services/telemetry/bluetooth/bluetoothBandChoice';
import type { BluetoothPermissions } from '../../../services/telemetry/bluetooth/bluetoothPermissions';
import { resetBluetoothStartProblem } from '../../../services/telemetry/bluetooth/useBluetoothHeartRate';

// O batimento direto da pulseira na tela de escolher: com a pulseira
// escolhida, a tela relê o status da ponte a cada 2 s e mostra o valor da
// última notificação, para a pessoa saber que a conexão está servindo. A
// fronteira dublada é a ponte do módulo nativo, que cumpre o contrato do
// invólucro (status já saneado).

const NOW = new Date('2026-10-22T15:00:00.000Z');
const POLAR: BandChoice = { deviceId: 'A0:9E:1A:00:00:01', name: 'Polar H10' };

// Flags 0x06 (o sensor mede contato e achou pele), batimento 72 em 8 bits.
const BYTES_72 = 'BkgA';
// Flags 0x04 (o sensor mede contato e não achou pele), batimento 0.
const BYTES_SEM_CONTATO = 'BAAA';
// Base64 válido, mas só as flags: falta o batimento.
const BYTES_CURTOS = 'Bg==';

interface PonteFalsa {
  ble: jest.Mocked<BleHeartRate>;
  status: BleHeartRateStatus;
  achar: (result: BleScanResult) => Promise<void>;
  mudar: (event: BleStateChangedEvent) => Promise<void>;
}

function ponteFalsa(status: Partial<BleHeartRateStatus> = {}): PonteFalsa {
  const scanListeners = new Set<(r: BleScanResult) => void>();
  const stateListeners = new Set<(e: BleStateChangedEvent) => void>();
  const p: PonteFalsa = {
    status: { state: 'idle', deviceId: null, lastReadingAt: null, lastBytes: null, ...status },
    ble: {
      supported: true,
      scan: jest.fn(async () => undefined),
      stopScan: jest.fn(),
      start: jest.fn(async (_deviceId: string) => undefined),
      stop: jest.fn(async () => undefined),
      rotateReadings: jest.fn(() => []),
      connectedIntervals: jest.fn((_sinceMs: number) => []),
      status: jest.fn(() => p.status),
      onScanResult: jest.fn((listener) => {
        scanListeners.add(listener);
        return () => scanListeners.delete(listener);
      }),
      onStateChanged: jest.fn((listener) => {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
      }),
    } as unknown as jest.Mocked<BleHeartRate>,
    achar: async (result) => {
      await act(async () => scanListeners.forEach((l) => l(result)));
    },
    mudar: async (event) => {
      p.status = { ...p.status, state: event.state, deviceId: event.deviceId };
      await act(async () => stateListeners.forEach((l) => l(event)));
    },
  };
  return p;
}

const conectada = (over: Partial<BleHeartRateStatus> = {}) =>
  ponteFalsa({ state: 'connected', deviceId: POLAR.deviceId, ...over });

function memoria(inicial: BandChoice | null) {
  let text: string | null = inicial ? JSON.stringify(inicial) : null;
  return {
    read: async () => text,
    write: async (next: string) => {
      text = next;
    },
  };
}

const permissoes: BluetoothPermissions = {
  request: async () => 'granted',
  openSettings: () => undefined,
};

let montada: ReactTestRenderer | null = null;

async function montar(ponte: PonteFalsa, escolha: BandChoice | null = POLAR) {
  const store = createBandChoiceStore(memoria(escolha));
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SwiThemeProvider>
        <BluetoothHeartRateMonitoring ble={ponte.ble} store={store} permissions={permissoes} />
      </SwiThemeProvider>,
    );
  });
  montada = tree;
  return tree;
}

const texto = (tree: ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join(' ');
};

const passar = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

const horaMinuto = (ms: number) => {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':');
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  resetBluetoothStartProblem();
});

afterEach(async () => {
  await act(async () => {
    montada?.unmount();
  });
  montada = null;
  jest.useRealTimers();
});

describe('Pulseira no Bluetooth: batimento direto da pulseira', () => {
  it('mostra o valor que acabou de chegar, rotulado direto da pulseira', async () => {
    const tree = await montar(conectada({ lastReadingAt: NOW.getTime() - 3_000, lastBytes: BYTES_72 }));
    expect(texto(tree)).toContain('72 bpm, agora há pouco');
    expect(texto(tree)).toContain('Direto da pulseira');
    expect(texto(tree)).not.toContain('aguardando leitura');
  });

  it('até 10 s a leitura vale; passou disso, a pulseira está conectada aguardando leitura', async () => {
    const noLimite = await montar(conectada({ lastReadingAt: NOW.getTime() - 10_000, lastBytes: BYTES_72 }));
    expect(texto(noLimite)).toContain('72 bpm, agora há pouco');
    await act(async () => noLimite.unmount());

    const passou = await montar(conectada({ lastReadingAt: NOW.getTime() - 10_001, lastBytes: BYTES_72 }));
    expect(texto(passou)).toContain('Pulseira conectada, aguardando leitura');
    expect(texto(passou)).not.toContain('bpm');
    expect(texto(passou)).not.toContain('Direto da pulseira');
  });

  it('com a tela aberta, a leitura envelhece sozinha a cada consulta de 2 s', async () => {
    const tree = await montar(conectada({ lastReadingAt: NOW.getTime(), lastBytes: BYTES_72 }));
    expect(texto(tree)).toContain('72 bpm, agora há pouco');
    await passar(10_000);
    expect(texto(tree)).toContain('72 bpm, agora há pouco');
    await passar(2_000);
    expect(texto(tree)).toContain('Pulseira conectada, aguardando leitura');
  });

  it('valor novo que chega na ponte aparece na consulta seguinte', async () => {
    const ponte = conectada({ lastReadingAt: NOW.getTime() - 20_000, lastBytes: BYTES_72 });
    const tree = await montar(ponte);
    expect(texto(tree)).toContain('aguardando leitura');
    // Flags 0x06, batimento 81.
    ponte.status = { ...ponte.status, lastReadingAt: NOW.getTime() + 1_000, lastBytes: 'BlEA' };
    await passar(2_000);
    expect(texto(tree)).toContain('81 bpm, agora há pouco');
  });

  it.each([
    ['base64 inválido', '***'],
    ['pacote curto', BYTES_CURTOS],
    ['sem contato com a pele', BYTES_SEM_CONTATO],
    ['sem bytes', null],
  ])('bytes ilegíveis (%s) contam como sem leitura', async (_caso, lastBytes) => {
    const tree = await montar(conectada({ lastReadingAt: NOW.getTime() - 1_000, lastBytes }));
    expect(texto(tree)).toContain('Pulseira conectada, aguardando leitura');
    expect(texto(tree)).not.toContain('bpm');
  });

  it('a conexão que cai mostra desde quando, pela hora da mudança de estado', async () => {
    const ponte = conectada({ lastReadingAt: NOW.getTime() - 1_000, lastBytes: BYTES_72 });
    const tree = await montar(ponte);
    const caiu = NOW.getTime() + 90_000;
    jest.setSystemTime(caiu);
    await ponte.mudar({ state: 'searching', deviceId: POLAR.deviceId, changedAt: caiu });

    expect(texto(tree)).toContain(`Pulseira desconectada desde ${horaMinuto(caiu)}`);
    expect(texto(tree)).not.toContain('bpm');
  });

  it.each(['searching', 'bluetoothOff', 'idle'] as const)(
    'aberta já sem conexão (%s), usa a hora da última leitura',
    async (state) => {
      const ultima = NOW.getTime() - 30 * 60_000;
      const tree = await montar(
        ponteFalsa({ state, deviceId: POLAR.deviceId, lastReadingAt: ultima, lastBytes: BYTES_72 }),
      );
      expect(texto(tree)).toContain(`Pulseira desconectada desde ${horaMinuto(ultima)}`);
      expect(texto(tree)).not.toContain('bpm');
    },
  );

  it('sem conexão e sem hora nenhuma, não inventa desde quando', async () => {
    const tree = await montar(ponteFalsa({ state: 'searching', deviceId: POLAR.deviceId }));
    expect(texto(tree)).not.toContain('desconectada');
    expect(texto(tree)).not.toContain('bpm');
  });

  it('o serviço ainda com a pulseira anterior não mostra o batimento dela', async () => {
    const tree = await montar(
      conectada({ deviceId: 'Z0:00', lastReadingAt: NOW.getTime() - 1_000, lastBytes: BYTES_72 }),
    );
    expect(texto(tree)).not.toContain('bpm');
    expect(texto(tree)).not.toContain('aguardando leitura');
  });

  it('a lista de pulseiras encontradas não mostra bpm', async () => {
    const ponte = conectada({ lastReadingAt: NOW.getTime() - 1_000, lastBytes: BYTES_72 });
    const tree = await montar(ponte);
    const trocar = tree.root.findAll(
      (node) => typeof node.props.onPress === 'function' && node.props.label === 'Trocar pulseira',
    )[0];
    await act(async () => trocar.props.onPress());
    await ponte.achar({ deviceId: POLAR.deviceId, name: 'Polar H10', rssi: -50 });
    await ponte.achar({ deviceId: 'C0:00:00:00:00:03', name: 'Cinta', rssi: -70 });

    type Grupo = { options: { label: string; value: string }[]; onChange: (v: string) => void };
    const grupo = tree.root.findAllByType(RadioGroup as React.ComponentType<Grupo>)[0];
    const rotulos = grupo.props.options.map((option: { label: string }) => option.label);
    expect(rotulos).toEqual(['Polar H10 · sinal forte', 'Cinta · sinal médio']);
    expect(texto(tree)).not.toContain('bpm');
  });

  it('consulta a ponte a cada 2 s com a pulseira escolhida e para ao sair da tela', async () => {
    const ponte = conectada({ lastReadingAt: NOW.getTime(), lastBytes: BYTES_72 });
    const tree = await montar(ponte);
    const antes = ponte.ble.status.mock.calls.length;
    await passar(2_000);
    expect(ponte.ble.status.mock.calls.length).toBeGreaterThan(antes);
    await passar(2_000);

    await act(async () => tree.unmount());
    montada = null;
    const aoSair = ponte.ble.status.mock.calls.length;
    await passar(20_000);
    expect(ponte.ble.status.mock.calls.length).toBe(aoSair);
  });

  it('sem pulseira escolhida não consulta a ponte', async () => {
    const ponte = ponteFalsa();
    await montar(ponte, null);
    const antes = ponte.ble.status.mock.calls.length;
    await passar(20_000);
    expect(ponte.ble.status.mock.calls.length).toBe(antes);
  });
});
