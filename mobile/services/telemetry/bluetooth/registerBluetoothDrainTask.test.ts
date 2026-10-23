import { AppRegistry, Platform } from 'react-native';
import { BLE_DRAIN_TASK_NAME } from './bluetoothInboxDrain';
import { registerBluetoothDrainTask, resetBluetoothDrainForNewPairing } from './registerBluetoothDrainTask';

const mockRun = jest.fn(async () => undefined);
const mockReset = jest.fn(async () => undefined);
const mockCreate = jest.fn((_deps: unknown) => ({ run: mockRun, resetForNewPairing: mockReset }));
jest.mock('./bluetoothInboxDrain', () => ({
  ...jest.requireActual('./bluetoothInboxDrain'),
  createBluetoothInboxDrain: (deps: unknown) => mockCreate(deps),
}));
jest.mock('../telemetryRuntime', () => ({ sharedTelemetryOutbox: () => ({}) }));
jest.mock('../../positions/positionOutbox', () => ({
  createFilePositionStorage: (name: string) => ({ name }),
}));

const mockReadChoice = jest.fn(async (_storage: unknown) => null);
jest.mock('./bluetoothBandChoice', () => ({
  createFileBandChoiceStorage: () => ({ name: 'bluetooth-band.json' }),
  readBandChoice: (storage: unknown) => mockReadChoice(storage),
}));

type TaskProvider = () => (data: unknown) => Promise<void>;

const originalOS = Platform.OS;
let register: jest.SpyInstance;
beforeEach(() => {
  register = jest.spyOn(AppRegistry, 'registerHeadlessTask').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.clearAllMocks();
  register.mockRestore();
  Object.defineProperty(Platform, 'OS', { value: originalOS });
});

const task = () => (register.mock.calls[0][1] as TaskProvider)();

describe('registerBluetoothDrainTask', () => {
  it('no Android registra a tarefa pelo nome que o Kotlin chama', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    registerBluetoothDrainTask();
    expect(register).toHaveBeenCalledWith(BLE_DRAIN_TASK_NAME, expect.any(Function));
  });

  it('fora do Android não registra nada', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    registerBluetoothDrainTask();
    expect(register).not.toHaveBeenCalled();
  });

  it('monta a drenagem só na primeira execução e a reaproveita depois', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    registerBluetoothDrainTask();
    expect(mockCreate).not.toHaveBeenCalled();
    await task()({});
    await task()({});
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledTimes(2);
    // O estado da drenagem fica num arquivo próprio, fora do rastreio.
    const deps = mockCreate.mock.calls[0][0] as { state: { name: string } };
    expect(deps.state).toEqual({ name: 'ble-heart-rate-drain.v1.json' });
    // A sessão segue a pulseira escolhida, lida do arquivo dela a cada rodada.
    const { choice } = mockCreate.mock.calls[0][0] as { choice: { read(): Promise<unknown> } };
    await choice.read();
    await choice.read();
    expect(mockReadChoice).toHaveBeenCalledTimes(2);
    expect(mockReadChoice).toHaveBeenCalledWith({ name: 'bluetooth-band.json' });
  });
});

describe('resetBluetoothDrainForNewPairing', () => {
  it('fora do Android não monta a drenagem nem faz nada', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    await expect(resetBluetoothDrainForNewPairing()).resolves.toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockReset).not.toHaveBeenCalled();
  });

  // A mesma drenagem da tarefa: é ela que serializa o reset com a rodada.
  it('no Android pede o reset à drenagem da tarefa', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    registerBluetoothDrainTask();
    await task()({});
    await resetBluetoothDrainForNewPairing();
    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
