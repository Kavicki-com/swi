import { AppState, Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import { LOCATION_TASK_NAME } from './backgroundLocationTask';
import { registerLocationTask } from './registerLocationTask';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

const mockHandle = jest.fn(async (_locations: unknown) => undefined);
interface MockHandlerDeps {
  activeEvacuation(): Promise<unknown>;
  onEvacuationEnded?(): void;
}
let mockHandlerDeps: MockHandlerDeps | null = null;
jest.mock('./backgroundLocationTask', () => ({
  ...jest.requireActual('./backgroundLocationTask'),
  createLocationHandler: (deps: MockHandlerDeps) => {
    mockHandlerDeps = deps;
    return { handle: mockHandle, reset: mockReset };
  },
}));
const mockGetActive = jest.fn();
jest.mock('../evacuation/getEvacuationBackend', () => ({
  getEvacuationBackend: () => ({ getActive: () => mockGetActive() }),
}));
const mockReset = jest.fn();
let mockActive = false;
const mockEndEvacuation = jest.fn(async () => undefined);
const mockSubscribe = jest.fn((_listener: () => void) => () => undefined);
jest.mock('./positionTracking', () => ({
  getPositionRuntime: () => ({
    outbox: {},
    window: {},
    drainer: {},
    tracking: {
      halt: jest.fn(),
      endEvacuation: mockEndEvacuation,
      subscribe: mockSubscribe,
      isActive: () => mockActive,
    },
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

  // Com o app em segundo plano, é a tarefa que pergunta ao servidor se uma
  // evacuação começou ou acabou. Sem rede, "não sei": nada muda.
  it('a tarefa pergunta ao servidor pela evacuação ativa', async () => {
    registerLocationTask();
    const perguntar = mockHandlerDeps!.activeEvacuation;
    mockGetActive.mockResolvedValueOnce({ id: 'e1', total: 1, ackedCount: 0, myAck: false });
    await expect(perguntar()).resolves.toEqual({ evacuationId: 'e1' });
    mockGetActive.mockResolvedValueOnce(null);
    await expect(perguntar()).resolves.toBeNull();
    mockGetActive.mockRejectedValueOnce(new Error('rede'));
    await expect(perguntar()).resolves.toBe('unknown');
  });

  // O fim visto pela tarefa, com o app na frente, passa pelo mesmo controle da
  // tela: as leituras voltam às opções da jornada (ou desligam) na hora, e a
  // notificação fixa deixa de falar em evacuação. Em segundo plano o Android
  // pode recusar religar o serviço, então fica para a volta ao primeiro plano.
  it('fim visto pela tarefa com o app na frente: o controle encerra a evacuação', () => {
    registerLocationTask();
    const estado = AppState as { currentState: unknown };
    const antes = estado.currentState;
    try {
      estado.currentState = 'active';
      mockHandlerDeps!.onEvacuationEnded!();
      expect(mockEndEvacuation).toHaveBeenCalledTimes(1);
      estado.currentState = 'background';
      mockHandlerDeps!.onEvacuationEnded!();
      expect(mockEndEvacuation).toHaveBeenCalledTimes(1);
    } finally {
      estado.currentState = antes;
    }
  });

  it('na web não define nada', () => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });
    registerLocationTask();
    expect(TaskManager.defineTask).not.toHaveBeenCalled();
  });
});
