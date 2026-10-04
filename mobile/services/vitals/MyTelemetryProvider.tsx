import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import {
  fetchMyTelemetry,
  type MetricState,
  type WorkerMetrics,
  type WorkerTelemetry,
} from '../telemetry/myTelemetry';

/** Intervalo de releitura enquanto o app não recebe o aviso por socket. */
export const MY_TELEMETRY_REFRESH_MS = 15_000;

/**
 * Por quanto tempo uma resposta vale sem outra mais nova: a janela em que o
 * backend ainda chama a leitura de atual.
 */
export const MY_TELEMETRY_HOLD_MS = 45_000;

export interface MyTelemetryState {
  /**
   * null enquanto carrega e quando não há leitura que ainda valha. Com o prazo
   * vencido e condição de urgência ou de saúde aberta, vem só com ela, sem
   * valor medido.
   */
  telemetry: WorkerTelemetry | null;
  /** Não há resposta dentro do prazo: a tela diz que a leitura está indisponível. */
  failed: boolean;
  /**
   * Ainda não houve resposta, ou a leitura venceu com o app parado e a
   * releitura ainda não respondeu.
   */
  loading: boolean;
}

const IDLE: MyTelemetryState = { telemetry: null, failed: false, loading: true };

const MyTelemetryContext = createContext<MyTelemetryState | null>(null);

const withoutValue = <T,>(state: MetricState<T>): MetricState<T> => ({
  ...state,
  value: null,
  quality: 'UNAVAILABLE',
});

// O que sobra de uma leitura que venceu. Os valores medidos somem, porque
// ninguém consegue mais confirmá-los. Urgência e alerta de saúde ficam:
// esconder uma condição aberta porque a rede caiu seria pior que mostrá-la
// atrasada. Condição só de aparelho não segura nada.
function afterHold(telemetry: WorkerTelemetry): WorkerTelemetry | null {
  const conditions = telemetry.conditions.filter((c) => c.category !== 'DEVICE');
  if (conditions.length === 0) return null;
  const metrics = Object.fromEntries(
    Object.entries(telemetry.metrics).map(([key, state]) => [key, withoutValue(state)]),
  ) as unknown as WorkerMetrics;
  return {
    ...telemetry,
    conditions,
    metrics: {
      ...metrics,
      energyRatePerHour: { ...metrics.energyRatePerHour, calculating: false },
    },
    bloodPressureRecency: 'NONE',
  };
}

// Estado atual do próprio funcionário, lido uma vez só para o app inteiro. A
// rota é autenticada e o provider mora acima do login: só lê com sessão, e
// limpa ao sair (mesmo padrão do WeatherProvider).
export function MyTelemetryProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const signedIn = user !== null;
  const [state, setState] = useState<MyTelemetryState>(IDLE);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    // O prazo de um pedido é maior que o intervalo de releitura, então um
    // pedido travado pode terminar depois de o seguinte já ter respondido.
    // Resposta de pedido mais antigo que o último aplicado é descartada.
    let issued = 0;
    let applied = 0;
    // A última resposta boa enquanto ela vale, e a hora em que foi pedida.
    let held: { telemetry: WorkerTelemetry; at: number } | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    // `awaiting`: a leitura venceu com o app parado e a releitura sai na volta.
    // Ninguém falhou ainda, então a tela espera em vez de dizer indisponível.
    const expire = (awaiting: boolean) => {
      if (holdTimer !== null) clearTimeout(holdTimer);
      holdTimer = null;
      if (cancelled || held === null) return;
      const telemetry = afterHold(held.telemetry);
      held = null;
      setState({ telemetry, failed: !awaiting, loading: awaiting });
    };

    const load = () => {
      const seq = ++issued;
      // O backend decide o que é atual ao atender o pedido: o prazo conta
      // daqui, e não da chegada, que pode vir muitos segundos depois.
      const issuedAt = Date.now();
      fetchMyTelemetry().then(
        (telemetry) => {
          if (cancelled || seq < applied) return;
          applied = seq;
          held = { telemetry, at: issuedAt };
          if (holdTimer !== null) clearTimeout(holdTimer);
          // Com a releitura parada ninguém tentou ler: o prazo que vence ali
          // é espera pela volta ao primeiro plano, não falha.
          holdTimer = setTimeout(
            () => expire(refreshTimer === null),
            Math.max(0, issuedAt + MY_TELEMETRY_HOLD_MS - Date.now()),
          );
          setState({ telemetry, failed: false, loading: false });
        },
        () => {
          // Só resposta boa avança `applied`: a falha de um pedido não pode
          // descartar a resposta boa de um anterior que ainda vai chegar. E
          // com leitura dentro do prazo a falha não muda a tela: quem a tira
          // é o fim do prazo. Depois dele, o que sobrou continua.
          if (cancelled || seq < applied || held !== null) return;
          setState((prev) => ({ telemetry: prev.telemetry, failed: true, loading: false }));
        },
      );
    };

    const stop = () => {
      if (refreshTimer !== null) clearInterval(refreshTimer);
      refreshTimer = null;
    };
    const start = () => {
      stop();
      load();
      refreshTimer = setInterval(load, MY_TELEMETRY_REFRESH_MS);
    };

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        // Com o app parado os timers ficam suspensos: na volta quem decide se
        // a leitura venceu é o relógio.
        if (held !== null && Date.now() - held.at >= MY_TELEMETRY_HOLD_MS) expire(true);
        start();
      } else if (next === 'background') {
        // O rastreio de posição mantém o app vivo com a tela apagada; a
        // leitura não precisa seguir sendo pedida sem ninguém olhando.
        stop();
      }
    });
    if (AppState.currentState !== 'background') start();

    return () => {
      cancelled = true;
      stop();
      if (holdTimer !== null) clearTimeout(holdTimer);
      sub.remove();
      setState(IDLE);
    };
  }, [signedIn]);

  return <MyTelemetryContext.Provider value={state}>{children}</MyTelemetryContext.Provider>;
}

export function useMyTelemetry(): MyTelemetryState {
  const ctx = useContext(MyTelemetryContext);
  if (!ctx) throw new Error('useMyTelemetry must be used inside MyTelemetryProvider');
  return ctx;
}
