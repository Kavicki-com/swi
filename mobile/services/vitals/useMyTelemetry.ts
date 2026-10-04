import { useEffect, useState } from 'react';
import { fetchMyTelemetry, type WorkerTelemetry } from '../telemetry/myTelemetry';

/** Intervalo de releitura enquanto o app não recebe o aviso por socket. */
export const MY_TELEMETRY_REFRESH_MS = 15_000;

export interface MyTelemetryState {
  /** null enquanto carrega ou quando a última leitura falhou. */
  telemetry: WorkerTelemetry | null;
  /** A última tentativa falhou: a tela diz que a leitura está indisponível. */
  failed: boolean;
  /** Ainda não houve nenhuma resposta. */
  loading: boolean;
}

// Estado atual do próprio funcionário, relido em intervalo fixo. Uma falha
// limpa a leitura anterior em vez de mantê-la: manter faria a tela afirmar
// "Monitorando agora" com um dado que ninguém consegue mais confirmar.
export function useMyTelemetry(): MyTelemetryState {
  const [state, setState] = useState<MyTelemetryState>({
    telemetry: null,
    failed: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    // O prazo de um pedido é maior que o intervalo de releitura, então um
    // pedido travado pode terminar depois de o seguinte já ter respondido.
    // Resposta de pedido mais antigo que o último aplicado é descartada: sem
    // isso, a falha atrasada apagaria uma leitura boa e mais nova.
    let issued = 0;
    let applied = 0;
    const load = () => {
      const seq = ++issued;
      const apply = (next: MyTelemetryState) => {
        if (cancelled || seq < applied) return;
        applied = seq;
        setState(next);
      };
      fetchMyTelemetry().then(
        (telemetry) => apply({ telemetry, failed: false, loading: false }),
        () => apply({ telemetry: null, failed: true, loading: false }),
      );
    };
    load();
    const timer = setInterval(load, MY_TELEMETRY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return state;
}
