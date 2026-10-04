import { useEffect, useState } from 'react';
import { fetchMySeries, type SeriesPeriod, type WorkerSeries } from '../telemetry/mySeries';

/** A série anda em baldes de hora ou de dia: reler a cada poucos minutos basta. */
export const MY_SERIES_REFRESH_MS = 5 * 60_000;

/** Depois de uma falha, a nova tentativa não espera esses minutos todos. */
export const MY_SERIES_RETRY_MS = 30_000;

export interface MySeriesState {
  /** null enquanto carrega ou quando a última leitura falhou. */
  series: WorkerSeries | null;
  /** A última tentativa falhou: a tela diz que a série está indisponível. */
  failed: boolean;
  /** Ainda não houve nenhuma resposta para o período pedido. */
  loading: boolean;
}

const LOADING: MySeriesState = { series: null, failed: false, loading: true };

// Série do próprio funcionário no período escolhido, relida em intervalo fixo.
// Uma falha limpa a série anterior em vez de mantê-la.
export function useMySeries(period: SeriesPeriod): MySeriesState {
  const [state, setState] = useState<MySeriesState & { period: SeriesPeriod }>({
    ...LOADING,
    period,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A próxima leitura só é marcada quando a anterior termina: pedido travado
    // não empilha outro por cima, e dentro do período não há resposta fora de
    // ordem.
    const load = () => {
      const settle = (next: MySeriesState, delayMs: number) => {
        if (cancelled) return;
        setState({ ...next, period });
        timer = setTimeout(load, delayMs);
      };
      fetchMySeries(period).then(
        (series) => settle({ series, failed: false, loading: false }, MY_SERIES_REFRESH_MS),
        () => settle({ series: null, failed: true, loading: false }, MY_SERIES_RETRY_MS),
      );
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [period]);

  // Trocar o período volta a "carregando" já no mesmo render: a série do
  // período anterior nunca aparece sob o rótulo do novo.
  if (state.period !== period) return LOADING;
  return { series: state.series, failed: state.failed, loading: state.loading };
}
