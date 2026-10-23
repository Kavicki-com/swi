import { createElement, type ComponentType } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { BleHeartRate } from '../../../modules/swi-ble-heart-rate/src';
import {
  bluetoothStartProblem,
  resetBluetoothStartProblem,
  useBluetoothHeartRate,
  useBluetoothHeartRateSession,
  type BluetoothHeartRateInput,
} from './useBluetoothHeartRate';

const TestRenderer: {
  create: (el: unknown) => { update: (el: unknown) => void; unmount: () => void };
  act: (cb: () => void | Promise<void>) => void | Promise<void>;
} = require('react-test-renderer');
const act = TestRenderer.act;

// Ponte falsa que cumpre o contrato do módulo: só o que o hook chama importa.
function fakeBle(over: Partial<BleHeartRate> = {}): jest.Mocked<BleHeartRate> {
  return {
    supported: true,
    scan: jest.fn(async () => undefined),
    stopScan: jest.fn(),
    start: jest.fn(async (_deviceId: string) => undefined),
    stop: jest.fn(async () => undefined),
    rotateReadings: jest.fn(() => []),
    connectedIntervals: jest.fn((_since: number) => []),
    status: jest.fn(() => ({ state: 'idle' as const, deviceId: null, lastReadingAt: null })),
    onScanResult: jest.fn(() => () => undefined),
    onStateChanged: jest.fn(() => () => undefined),
    ...over,
  } as jest.Mocked<BleHeartRate>;
}

const coded = (code: string) => Object.assign(new Error(code), { code });

// O AppState de verdade não muda sob a suíte: o ouvinte é capturado e chamado
// à mão, e o estado atual é trocado pela propriedade.
let listeners: ((state: AppStateStatus) => void)[];
const remove = jest.fn();
const appState = async (state: AppStateStatus) => {
  await act(async () => listeners.forEach((listener) => listener(state)));
};
let currentState: AppStateStatus;
beforeEach(() => {
  listeners = [];
  remove.mockClear();
  currentState = 'active';
  resetBluetoothStartProblem();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    listeners.push(cb as (state: AppStateStatus) => void);
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  Object.defineProperty(AppState, 'currentState', { get: () => currentState, configurable: true });
});
afterEach(() => jest.restoreAllMocks());

const PULSEIRA = 'A0:9E:1A:00:00:01';

interface Props extends Partial<BluetoothHeartRateInput> {
  ble: BleHeartRate;
  enabled?: boolean;
}
function Harness({ ble, enabled = true, ...input }: Props) {
  useBluetoothHeartRate({ userId: 'u1', paired: true, deviceId: PULSEIRA, ...input }, ble, enabled);
  return null;
}
const harness = (props: Props) => createElement(Harness as ComponentType<any>, props);

async function montar(props: Props) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(harness(props));
  });
  return renderer;
}

describe('useBluetoothHeartRate', () => {
  it('escolher a pulseira liga a escuta na hora, sem jornada nenhuma', async () => {
    const ble = fakeBle();
    const r = await montar({ ble, deviceId: null });
    expect(ble.start).not.toHaveBeenCalled();
    await act(async () => r.update(harness({ ble, deviceId: PULSEIRA })));
    expect(ble.start).toHaveBeenCalledWith(PULSEIRA);
    expect(ble.stop).toHaveBeenCalledTimes(1);
  });

  it('com a pulseira escolhida e o aparelho pareado, liga ao abrir o app', async () => {
    const ble = fakeBle();
    await montar({ ble });
    expect(ble.start).toHaveBeenCalledWith(PULSEIRA);
    expect(ble.stop).not.toHaveBeenCalled();
  });

  it('não desliga sozinha: 13 h depois segue ligada', async () => {
    jest.useFakeTimers();
    try {
      const ble = fakeBle();
      await montar({ ble });
      await act(async () => {
        jest.advanceTimersByTime(13 * 60 * 60 * 1000);
      });
      expect(ble.stop).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('encerrar (escolha apagada) desliga; escolher de novo liga', async () => {
    const ble = fakeBle();
    const r = await montar({ ble });
    await act(async () => r.update(harness({ ble, deviceId: null })));
    expect(ble.stop).toHaveBeenCalledTimes(1);
    await act(async () => r.update(harness({ ble, deviceId: PULSEIRA })));
    expect(ble.start).toHaveBeenCalledTimes(2);
  });

  it('escolha da pulseira ainda não lida não age', async () => {
    const ble = fakeBle();
    await montar({ ble, deviceId: undefined });
    expect(ble.start).not.toHaveBeenCalled();
    expect(ble.stop).not.toHaveBeenCalled();
  });

  it('sem pulseira escolhida não liga e desliga o que vinha de antes', async () => {
    const ble = fakeBle();
    await montar({ ble, deviceId: null });
    expect(ble.start).not.toHaveBeenCalled();
    expect(ble.stop).toHaveBeenCalledTimes(1);
  });

  it('sem pareamento não liga, e o pareamento revogado desliga', async () => {
    const ble = fakeBle();
    await montar({ ble, paired: false });
    expect(ble.start).not.toHaveBeenCalled();

    const outra = fakeBle();
    const r = await montar({ ble: outra });
    await act(async () => r.update(harness({ ble: outra, paired: false })));
    expect(outra.stop).toHaveBeenCalled();
  });

  it('sem sessão não age', async () => {
    const ble = fakeBle();
    await montar({ ble, userId: null });
    expect(ble.start).not.toHaveBeenCalled();
    expect(ble.stop).not.toHaveBeenCalled();
  });

  it('com o gate desligado ou sem módulo, nada é chamado', async () => {
    const semGate = fakeBle();
    await montar({ ble: semGate, enabled: false });
    const semModulo = fakeBle({ supported: false });
    await montar({ ble: semModulo });
    for (const ble of [semGate, semModulo]) {
      expect(ble.start).not.toHaveBeenCalled();
      expect(ble.stop).not.toHaveBeenCalled();
    }
  });

  it('trocar de pulseira liga com a nova', async () => {
    const ble = fakeBle();
    const r = await montar({ ble });
    await act(async () => r.update(harness({ ble, deviceId: 'B0:00:00:00:00:02' })));
    expect(ble.start).toHaveBeenLastCalledWith('B0:00:00:00:00:02');
  });

  it('com o app fora do primeiro plano não pede o serviço; pede ao voltar', async () => {
    // O Android recusa subir serviço em primeiro plano pedido do segundo plano.
    currentState = 'background';
    const ble = fakeBle();
    await montar({ ble });
    expect(ble.start).not.toHaveBeenCalled();

    currentState = 'active';
    await appState('active');
    expect(ble.start).toHaveBeenCalledWith(PULSEIRA);
  });

  it('a falha ao ligar fica guardada pelo código, e a volta ao primeiro plano tenta de novo', async () => {
    const ble = fakeBle();
    ble.start.mockRejectedValueOnce(coded('E_PERMISSION_DENIED'));
    await montar({ ble });
    expect(bluetoothStartProblem()).toBe('E_PERMISSION_DENIED');

    await appState('active');
    expect(ble.start).toHaveBeenCalledTimes(2);
    expect(bluetoothStartProblem()).toBeNull();
  });

  it('falha sem código do contrato vira "unknown"', async () => {
    const ble = fakeBle();
    ble.start.mockRejectedValueOnce(new Error('qualquer'));
    await montar({ ble });
    expect(bluetoothStartProblem()).toBe('unknown');
  });

  it('desligar limpa a falha guardada', async () => {
    const ble = fakeBle();
    ble.start.mockRejectedValueOnce(coded('E_START_FAILED'));
    const r = await montar({ ble });
    await act(async () => r.update(harness({ ble, deviceId: null })));
    expect(bluetoothStartProblem()).toBeNull();
  });

  it('desmontar não desliga: quem desliga no logout é a sessão', async () => {
    const ble = fakeBle();
    const r = await montar({ ble });
    await act(async () => r.unmount());
    expect(ble.stop).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });
});

interface SessionProps {
  userId: string | null;
  restoring?: boolean;
  ble: BleHeartRate;
  enabled?: boolean;
  tokenExists?: () => Promise<boolean>;
  endBand?: () => Promise<void>;
}
const noopEnd = async () => undefined;
function SessionHarness({ userId, restoring = false, ble, enabled = true, tokenExists, endBand }: SessionProps) {
  useBluetoothHeartRateSession(userId, restoring, ble, enabled, tokenExists ?? (async () => true), endBand ?? noopEnd);
  return null;
}
const session = (props: SessionProps) => createElement(SessionHarness as ComponentType<any>, props);

describe('useBluetoothHeartRateSession', () => {
  it('logout encerra: desliga a escuta e apaga a pulseira escolhida', async () => {
    const ble = fakeBle();
    const endBand = jest.fn(async () => undefined);
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      r = TestRenderer.create(session({ userId: 'u1', ble, endBand }));
    });
    expect(ble.stop).not.toHaveBeenCalled();
    expect(endBand).not.toHaveBeenCalled();
    await act(async () => r.update(session({ userId: null, ble, endBand })));
    expect(ble.stop).toHaveBeenCalledTimes(1);
    expect(endBand).toHaveBeenCalledTimes(1);
  });

  it('a escolha que não pôde ser apagada no logout não derruba nada', async () => {
    const ble = fakeBle();
    const endBand = jest.fn(async () => {
      throw new Error('disco');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      r = TestRenderer.create(session({ userId: 'u1', ble, endBand }));
    });
    await act(async () => r.update(session({ userId: null, ble, endBand })));
    expect(ble.stop).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('app aberto sem sessão e sem token encerra o que vinha de antes', async () => {
    const ble = fakeBle();
    const endBand = jest.fn(async () => undefined);
    await act(async () => {
      TestRenderer.create(session({ userId: null, ble, tokenExists: async () => false, endBand }));
    });
    expect(ble.stop).toHaveBeenCalled();
    expect(endBand).toHaveBeenCalledTimes(1);
  });

  it('sem sessão mas com token guardado não desliga, nem enquanto restaura', async () => {
    const ble = fakeBle();
    const endBand = jest.fn(async () => undefined);
    await act(async () => {
      TestRenderer.create(session({ userId: null, ble, tokenExists: async () => true, endBand }));
    });
    await act(async () => {
      TestRenderer.create(session({ userId: null, restoring: true, ble, tokenExists: async () => false, endBand }));
    });
    expect(ble.stop).not.toHaveBeenCalled();
    expect(endBand).not.toHaveBeenCalled();
  });

  it('com o gate desligado ou sem módulo, nada é chamado', async () => {
    const ble = fakeBle({ supported: false });
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      r = TestRenderer.create(session({ userId: 'u1', ble, tokenExists: async () => false }));
    });
    await act(async () => r.update(session({ userId: null, ble, tokenExists: async () => false })));
    const semGate = fakeBle();
    await act(async () => {
      TestRenderer.create(session({ userId: null, ble: semGate, enabled: false, tokenExists: async () => false }));
    });
    expect(ble.stop).not.toHaveBeenCalled();
    expect(semGate.stop).not.toHaveBeenCalled();
  });
});
