import { AppRegistry, Platform } from 'react-native';
import { BLE_DRAIN_TASK_NAME } from './bluetoothInboxDrain';
import { registerBluetoothDrainTask } from './registerBluetoothDrainTask';

const mockRun = jest.fn(async () => undefined);
const mockCreate = jest.fn((_deps: unknown) => ({ run: mockRun }));
jest.mock('./bluetoothInboxDrain', () => ({
  ...jest.requireActual('./bluetoothInboxDrain'),
  createBluetoothInboxDrain: (deps: unknown) => mockCreate(deps),
}));
jest.mock('../telemetryRuntime', () => ({ sharedTelemetryOutbox: () => ({}) }));
jest.mock('../../positions/positionOutbox', () => ({
  createFilePositionStorage: (name: string) => ({ name }),
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
  });
});
