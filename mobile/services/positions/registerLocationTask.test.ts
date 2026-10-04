import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import { LOCATION_TASK_NAME } from './backgroundLocationTask';
import { registerLocationTask } from './registerLocationTask';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

const mockHandle = jest.fn(async (_locations: unknown) => undefined);
jest.mock('./backgroundLocationTask', () => ({
  ...jest.requireActual('./backgroundLocationTask'),
  createLocationHandler: () => ({ handle: mockHandle, reset: mockReset }),
}));
const mockReset = jest.fn();
let mockActive = false;
const mockSubscribe = jest.fn((_listener: () => void) => () => undefined);
jest.mock('./positionTracking', () => ({
  getPositionRuntime: () => ({
    outbox: {},
    window: {},
    drainer: {},
    tracking: { halt: jest.fn(), subscribe: mockSubscribe, isActive: () => mockActive },
  }),
}));

type Executor = (body: { data?: unknown; error?: unknown }) => Promise<void>;
const executor = (): Executor => (TaskManager.defineTask as jest.Mock).mock.calls[0][1];

const originalOS = Platform.OS;
afterEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: originalOS });
});

describe('registerLocationTask', () => {
  it('define a tarefa pelo nome e repassa as leituras', async () => {
    registerLocationTask();
    expect(TaskManager.defineTask).toHaveBeenCalledWith(LOCATION_TASK_NAME, expect.any(Function));
    const locations = [{ timestamp: 1, coords: { latitude: 1, longitude: 2 } }];
    await executor()({ data: { locations } });
    expect(mockHandle).toHaveBeenCalledWith(locations);
  });

  it('erro do sistema ou entrega sem leituras não chama o tratamento', async () => {
    registerLocationTask();
    await executor()({ error: new Error('kCLErrorDomain') });
    await executor()({ data: {} });
    await executor()({});
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('falha no tratamento é engolida com aviso, sem derrubar a tarefa', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockHandle.mockRejectedValueOnce(new Error('disco'));
    registerLocationTask();
    await expect(executor()({ data: { locations: [] } })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('quando o rastreio desliga, o filtro em memória da tarefa é zerado', () => {
    registerLocationTask();
    const avisar = mockSubscribe.mock.calls[0][0];
    mockActive = true;
    avisar();
    expect(mockReset).not.toHaveBeenCalled();
    mockActive = false;
    avisar();
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('na web não define nada', () => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });
    registerLocationTask();
    expect(TaskManager.defineTask).not.toHaveBeenCalled();
  });
});
