import { act, create } from 'react-test-renderer';
import { createElement } from 'react';
import { fetchMyTelemetry } from '../telemetry/myTelemetry';
import { neverReported, reporting } from '../telemetry/myTelemetryFixtures';
import { MY_TELEMETRY_REFRESH_MS, useMyTelemetry, type MyTelemetryState } from './useMyTelemetry';

jest.mock('../telemetry/myTelemetry', () => ({ fetchMyTelemetry: jest.fn() }));

const fetchMock = fetchMyTelemetry as jest.MockedFunction<typeof fetchMyTelemetry>;

const probe = () => {
  const seen: MyTelemetryState[] = [];
  function Probe() {
    seen.push(useMyTelemetry());
    return null;
  }
  return { Probe, seen, last: () => seen[seen.length - 1]! };
};

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useMyTelemetry', () => {
  it('começa carregando e entrega a leitura do backend', async () => {
    fetchMock.mockResolvedValue(reporting());
    const { Probe, seen, last } = probe();
    await act(async () => {
      create(createElement(Probe));
    });
    expect(seen[0]).toEqual({ telemetry: null, failed: false, loading: true });
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);
    expect(last().loading).toBe(false);
  });

  it('relê sozinha no intervalo', async () => {
    fetchMock.mockResolvedValue(neverReported());
    const { Probe } = probe();
    await act(async () => {
      create(createElement(Probe));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(MY_TELEMETRY_REFRESH_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Manter a leitura anterior faria a tela afirmar "Monitorando agora" com um
  // dado que ninguém consegue mais confirmar.
  it('falha limpa a leitura anterior e marca a falha', async () => {
    fetchMock.mockResolvedValueOnce(reporting()).mockRejectedValueOnce(new Error('offline'));
    const { Probe, last } = probe();
    await act(async () => {
      create(createElement(Probe));
    });
    await act(async () => {
      jest.advanceTimersByTime(MY_TELEMETRY_REFRESH_MS);
    });
    expect(last()).toEqual({ telemetry: null, failed: true, loading: false });
  });

  // O prazo de um pedido (20 s) é maior que o intervalo de releitura (15 s):
  // um pedido travado pode falhar DEPOIS de o seguinte já ter respondido.
  it('falha atrasada de um pedido antigo não apaga a leitura mais nova', async () => {
    let falharPrimeiro!: (e: Error) => void;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            falharPrimeiro = reject;
          }),
      )
      .mockResolvedValueOnce(reporting());
    const { Probe, last } = probe();
    await act(async () => {
      create(createElement(Probe));
    });
    await act(async () => {
      jest.advanceTimersByTime(MY_TELEMETRY_REFRESH_MS);
    });
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);

    await act(async () => {
      falharPrimeiro(new Error('timeout'));
    });
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);
    expect(last().failed).toBe(false);
  });

  it('para de ler ao desmontar', async () => {
    fetchMock.mockResolvedValue(neverReported());
    const { Probe } = probe();
    let root: ReturnType<typeof create>;
    await act(async () => {
      root = create(createElement(Probe));
    });
    // A limpeza do efeito só roda ao fim do act; avançar o relógio no mesmo act
    // mediria o intervalo ainda vivo.
    await act(async () => {
      root.unmount();
    });
    await act(async () => {
      jest.advanceTimersByTime(MY_TELEMETRY_REFRESH_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
