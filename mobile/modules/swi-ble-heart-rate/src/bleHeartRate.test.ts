import {
  createBleHeartRate,
  loadNativeBleHeartRate,
  requiredBluetoothPermissions,
} from './bleHeartRate';
import {
  bleHeartRateErrorCode,
  type BleScanResult,
  type BleStateChangedEvent,
  type SwiBleHeartRateNative,
} from './SwiBleHeartRate.types';

jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: jest.fn(() => ({ marker: 'native' })),
}));

type Listener = (event: unknown) => void;

function fakeNative(overrides: Partial<SwiBleHeartRateNative> = {}) {
  const listeners: Record<string, Listener[]> = {};
  const native = {
    scan: jest.fn(async () => undefined),
    stopScan: jest.fn(),
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    rotateReadings: jest.fn((): unknown => []),
    connectedIntervals: jest.fn((): unknown => []),
    status: jest.fn((): unknown => ({ state: 'idle', deviceId: null, lastReadingAt: null })),
    addListener: jest.fn((name: string, listener: Listener) => {
      (listeners[name] ??= []).push(listener);
      return {
        remove: () => {
          listeners[name] = listeners[name].filter((l) => l !== listener);
        },
      };
    }),
    ...overrides,
  };
  const emit = (name: string, event: unknown) => (listeners[name] ?? []).forEach((l) => l(event));
  const count = (name: string) => (listeners[name] ?? []).length;
  return { native: native as unknown as SwiBleHeartRateNative, raw: native, emit, count };
}

describe('loadNativeBleHeartRate', () => {
  it('só procura o módulo no Android', () => {
    expect(loadNativeBleHeartRate('ios')).toBeNull();
    expect(loadNativeBleHeartRate('web')).toBeNull();
    expect(loadNativeBleHeartRate('android')).toEqual({ marker: 'native' });
  });
});

describe('createBleHeartRate sem módulo nativo', () => {
  const ble = createBleHeartRate(null);

  it('declara que não há suporte', () => {
    expect(ble.supported).toBe(false);
  });

  it('rejeita scan e start com E_UNSUPPORTED, sem fingir sucesso', async () => {
    await expect(ble.scan()).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    await expect(ble.start('AA:BB:CC:DD:EE:FF')).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
  });

  it('fica inerte no resto', async () => {
    expect(() => ble.stopScan()).not.toThrow();
    await expect(ble.stop()).resolves.toBeUndefined();
    expect(ble.rotateReadings()).toEqual([]);
    expect(ble.connectedIntervals(0)).toEqual([]);
    expect(ble.status()).toEqual({ state: 'idle', deviceId: null, lastReadingAt: null });
    const off = ble.onScanResult(jest.fn());
    const off2 = ble.onStateChanged(jest.fn());
    expect(() => {
      off();
      off2();
    }).not.toThrow();
  });
});

describe('createBleHeartRate com módulo nativo', () => {
  it('repassa scan, stopScan, start e stop', async () => {
    const { native, raw } = fakeNative();
    const ble = createBleHeartRate(native);
    expect(ble.supported).toBe(true);
    await ble.scan();
    ble.stopScan();
    await ble.start('AA:BB:CC:DD:EE:FF');
    await ble.stop();
    expect(raw.scan).toHaveBeenCalledTimes(1);
    expect(raw.stopScan).toHaveBeenCalledTimes(1);
    expect(raw.start).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
    expect(raw.stop).toHaveBeenCalledTimes(1);
  });

  it('deixa a rejeição do nativo passar com o código intacto', async () => {
    const error = Object.assign(new Error('sem permissão'), { code: 'E_PERMISSION_DENIED' });
    const { native } = fakeNative({ start: jest.fn(async () => Promise.reject(error)) });
    const ble = createBleHeartRate(native);
    const rejection = await ble.start('AA:BB:CC:DD:EE:FF').catch((e: unknown) => e);
    expect(bleHeartRateErrorCode(rejection)).toBe('E_PERMISSION_DENIED');
  });

  it('recusa endereço vazio antes de chegar ao nativo', async () => {
    const { native, raw } = fakeNative();
    const ble = createBleHeartRate(native);
    await expect(ble.start('  ')).rejects.toThrow();
    expect(raw.start).not.toHaveBeenCalled();
  });

  describe('rotateReadings', () => {
    it('devolve só leituras com base64 e horário válidos', () => {
      const { native } = fakeNative({
        rotateReadings: jest.fn(() => [
          { bytes: 'BkY=', receivedAt: 1_761_109_475_697 },
          { bytes: '', receivedAt: 1_761_109_476_000 },
          { bytes: 'BkY=', receivedAt: Number.NaN },
          { bytes: 'BkY=', receivedAt: -5 },
          { bytes: 42, receivedAt: 1_761_109_477_000 },
          null,
          'lixo',
          { bytes: 'BEg=', receivedAt: 1_761_109_478_000 },
        ]),
      });
      expect(createBleHeartRate(native).rotateReadings()).toEqual([
        { bytes: 'BkY=', receivedAt: 1_761_109_475_697 },
        { bytes: 'BEg=', receivedAt: 1_761_109_478_000 },
      ]);
    });

    it('devolve lista vazia quando o nativo devolve algo que não é lista', () => {
      const { native } = fakeNative({ rotateReadings: jest.fn(() => ({ nope: true })) });
      expect(createBleHeartRate(native).rotateReadings()).toEqual([]);
    });

    it('não derruba a drenagem quando o nativo lança', () => {
      const { native } = fakeNative({
        rotateReadings: jest.fn(() => {
          throw new Error('disco');
        }),
      });
      expect(createBleHeartRate(native).rotateReadings()).toEqual([]);
    });
  });

  describe('connectedIntervals', () => {
    it('repassa o início pedido e saneia os intervalos', () => {
      const connectedIntervals = jest.fn(() => [
        { start: 1_000, end: 2_000 },
        { start: 3_000, end: null },
        { start: 5_000, end: 4_000 },
        { start: 'x', end: 6_000 },
        { start: 7_000 },
        null,
      ]);
      const { native } = fakeNative({ connectedIntervals });
      expect(createBleHeartRate(native).connectedIntervals(500)).toEqual([
        { start: 1_000, end: 2_000 },
        { start: 3_000, end: null },
        { start: 7_000, end: null },
      ]);
      expect(connectedIntervals).toHaveBeenCalledWith(500);
    });

    it('devolve lista vazia quando o nativo lança', () => {
      const { native } = fakeNative({
        connectedIntervals: jest.fn(() => {
          throw new Error('disco');
        }),
      });
      expect(createBleHeartRate(native).connectedIntervals(0)).toEqual([]);
    });
  });

  describe('status', () => {
    it('passa o que tem a forma do contrato', () => {
      const { native } = fakeNative({
        status: jest.fn(() => ({ state: 'connected', deviceId: 'AA:BB', lastReadingAt: 1_000 })),
      });
      expect(createBleHeartRate(native).status()).toEqual({
        state: 'connected',
        deviceId: 'AA:BB',
        lastReadingAt: 1_000,
      });
    });

    it('troca estado desconhecido por idle e campos tortos por null', () => {
      const { native } = fakeNative({
        status: jest.fn(() => ({ state: 'flying', deviceId: '', lastReadingAt: 0 })),
      });
      expect(createBleHeartRate(native).status()).toEqual({
        state: 'idle',
        deviceId: null,
        lastReadingAt: null,
      });
    });

    it('não lança quando o nativo lança ou devolve lixo', () => {
      const throwing = fakeNative({
        status: jest.fn(() => {
          throw new Error('x');
        }),
      });
      expect(createBleHeartRate(throwing.native).status().state).toBe('idle');
      const garbage = fakeNative({ status: jest.fn(() => null) });
      expect(createBleHeartRate(garbage.native).status().state).toBe('idle');
    });
  });

  describe('eventos', () => {
    it('entrega resultados de varredura saneados e solta o ouvinte', () => {
      const { native, emit, count } = fakeNative();
      const seen: BleScanResult[] = [];
      const off = createBleHeartRate(native).onScanResult((r) => seen.push(r));
      emit('onScanResult', { deviceId: 'AA:BB', name: 'Polar H10', rssi: -60 });
      emit('onScanResult', { deviceId: 'CC:DD', name: '', rssi: -70 });
      emit('onScanResult', { deviceId: '', name: 'x', rssi: -70 });
      emit('onScanResult', { deviceId: 'EE:FF', name: 'x', rssi: Number.NaN });
      emit('onScanResult', null);
      expect(seen).toEqual([
        { deviceId: 'AA:BB', name: 'Polar H10', rssi: -60 },
        { deviceId: 'CC:DD', name: null, rssi: -70 },
      ]);
      off();
      expect(count('onScanResult')).toBe(0);
    });

    it('entrega mudanças de estado conhecidas e ignora as tortas', () => {
      const { native, emit, count } = fakeNative();
      const seen: BleStateChangedEvent[] = [];
      const off = createBleHeartRate(native).onStateChanged((e) => seen.push(e));
      emit('onStateChanged', { state: 'connected', deviceId: 'AA:BB', changedAt: 1_000 });
      emit('onStateChanged', { state: 'idle', deviceId: null, changedAt: 2_000 });
      emit('onStateChanged', { state: 'weird', deviceId: 'AA:BB', changedAt: 3_000 });
      emit('onStateChanged', { state: 'searching', deviceId: 'AA:BB', changedAt: 'ontem' });
      expect(seen).toEqual([
        { state: 'connected', deviceId: 'AA:BB', changedAt: 1_000 },
        { state: 'idle', deviceId: null, changedAt: 2_000 },
      ]);
      off();
      expect(count('onStateChanged')).toBe(0);
    });
  });
});

describe('bleHeartRateErrorCode', () => {
  it('só reconhece os códigos do contrato', () => {
    expect(bleHeartRateErrorCode({ code: 'E_BLUETOOTH_OFF' })).toBe('E_BLUETOOTH_OFF');
    expect(bleHeartRateErrorCode({ code: 'E_OTHER' })).toBeNull();
    expect(bleHeartRateErrorCode(new Error('x'))).toBeNull();
    expect(bleHeartRateErrorCode(null)).toBeNull();
    expect(bleHeartRateErrorCode('E_BLUETOOTH_OFF')).toBeNull();
  });
});

describe('requiredBluetoothPermissions', () => {
  it('pede varredura e conexão no Android 12 ou mais', () => {
    expect(requiredBluetoothPermissions(31)).toEqual([
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
    ]);
    expect(requiredBluetoothPermissions(36)).toEqual([
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
    ]);
  });

  it('pede localização precisa do Android 8 ao 11', () => {
    expect(requiredBluetoothPermissions(26)).toEqual(['android.permission.ACCESS_FINE_LOCATION']);
    expect(requiredBluetoothPermissions(30)).toEqual(['android.permission.ACCESS_FINE_LOCATION']);
  });
});
