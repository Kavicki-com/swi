import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createElement } from 'react';
import { fetchMySeries, type SeriesPeriod, type WorkerSeries } from '../telemetry/mySeries';
import { series } from '../telemetry/mySeriesFixtures';
import {
  MY_SERIES_REFRESH_MS,
  MY_SERIES_RETRY_MS,
  useMySeries,
  type MySeriesState,
} from './useMySeries';

jest.mock('../telemetry/mySeries', () => ({ fetchMySeries: jest.fn() }));

const fetchMock = fetchMySeries as jest.MockedFunction<typeof fetchMySeries>;

const probe = () => {
  const seen: MySeriesState[] = [];
  function Probe({ period }: { period: SeriesPeriod }) {
    seen.push(useMySeries(period));
    return null;
  }
  return { Probe, seen, last: () => seen[seen.length - 1]! };
};

const LOADING = { series: null, failed: false, loading: true };

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useMySeries', () => {
  it('começa carregando e entrega a série do período pedido', async () => {
    fetchMock.mockResolvedValue(series('day', [120, 80]));
    const { Probe, seen, last } = probe();
    await act(async () => {
      create(createElement(Probe, { period: 'day' }));
    });
    expect(seen[0]).toEqual(LOADING);
    expect(fetchMock).toHaveBeenCalledWith('day');
    expect(last().series?.points).toHaveLength(2);
    expect(last().loading).toBe(false);
  });

  it('relê sozinha no intervalo', async () => {
    fetchMock.mockResolvedValue(series('day', [120]));
    const { Probe } = probe();
    await act(async () => {
      create(createElement(Probe, { period: 'day' }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(MY_SERIES_REFRESH_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falha limpa a série em vez de manter um gráfico que ninguém confirma', async () => {
    fetchMock.mockResolvedValueOnce(series('day', [120]));
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { Probe, last } = probe();
    await act(async () => {
      create(createElement(Probe, { period: 'day' }));
    });
    expect(last().series).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(MY_SERIES_REFRESH_MS);
    });
    expect(last()).toEqual({ series: null, failed: true, loading: false });
  });

  it('depois de uma falha tenta de novo logo, sem esperar o intervalo inteiro', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fetchMock.mockResolvedValue(series('day', [120]));
    const { Probe, last } = probe();
    await act(async () => {
      create(createElement(Probe, { period: 'day' }));
    });
    expect(last().failed).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(MY_SERIES_RETRY_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(last()).toMatchObject({ failed: false, loading: false });
    expect(last().series).not.toBeNull();
  });

  // Uma leitura só parte depois de a anterior terminar: pedido travado não
  // empilha outro por cima, e não há resposta fora de ordem dentro do período.
  it('não dispara leitura nova enquanto a anterior não respondeu', async () => {
    fetchMock.mockImplementation(() => new Promise<WorkerSeries>(() => {}));
    const { Probe } = probe();
    await act(async () => {
      create(createElement(Probe, { period: 'day' }));
    });
    await act(async () => {
      jest.advanceTimersByTime(MY_SERIES_REFRESH_MS * 3);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('trocar o período volta a carregar na hora e busca o período novo', async () => {
    fetchMock.mockImplementation(async (period) => series(period, [100]));
    const { Probe, seen, last } = probe();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(createElement(Probe, { period: 'day' }));
    });
    expect(last().series?.period).toBe('day');

    const antes = seen.length;
    await act(async () => {
      tree.update(createElement(Probe, { period: 'week' }));
    });
    // O primeiro render com o período novo já não mostra a série do anterior.
    expect(seen[antes]).toEqual(LOADING);
    expect(fetchMock).toHaveBeenLastCalledWith('week');
    expect(last().series?.period).toBe('week');
  });

  it('resposta atrasada do período anterior não sobrescreve o atual', async () => {
    let soltarDia!: (s: WorkerSeries) => void;
    fetchMock.mockImplementation((period) =>
      period === 'day'
        ? new Promise<WorkerSeries>((resolve) => {
            soltarDia = resolve;
          })
        : Promise.resolve(series(period, [100])),
    );
    const { Probe, last } = probe();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(createElement(Probe, { period: 'day' }));
    });
    await act(async () => {
      tree.update(createElement(Probe, { period: 'month' }));
    });
    await act(async () => {
      soltarDia(series('day', [999]));
    });
    expect(last().series?.period).toBe('month');
  });

  it('desmontar para de reler', async () => {
    fetchMock.mockResolvedValue(series('day', [120]));
    const { Probe } = probe();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(createElement(Probe, { period: 'day' }));
    });
    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      jest.advanceTimersByTime(MY_SERIES_REFRESH_MS * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
