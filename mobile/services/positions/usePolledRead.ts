import { useEffect, useRef, useState } from 'react';

export interface PolledRead<T> {
  // null: camada desligada, ainda lendo, ou falhou sem leitura anterior.
  data: T | null;
  // A última tentativa falhou. O dado anterior, se houver, segue valendo.
  failed: boolean;
}

const IDLE = { data: null, failed: false } as const;

// Alimenta uma camada do mapa: lê quando a camada liga, relê em cadência fixa
// e para quando ela desliga ou a tela sai. Desligar esquece o dado, para a
// camada religada não piscar com uma leitura velha.
//
// `retryMs` serve às cadências longas: depois de uma falha, tenta de novo nesse
// prazo em vez de esperar o intervalo inteiro. Sem ele, só o intervalo relê.
export function usePolledRead<T>(
  enabled: boolean,
  read: () => Promise<T>,
  intervalMs: number,
  retryMs?: number,
): PolledRead<T> {
  const [state, setState] = useState<PolledRead<T>>(IDLE);
  // Leitor em ref: o efeito depende só de ligar e desligar, e sempre chama a
  // função corrente.
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      readRef.current().then(
        (data) => {
          if (!cancelled) setState({ data, failed: false });
        },
        () => {
          if (cancelled) return;
          setState((prev) => ({ data: prev.data, failed: true }));
          if (retryMs === undefined) return;
          // Uma nova tentativa pendente por vez, venha a falha de onde vier.
          clearTimeout(retry);
          retry = setTimeout(tick, retryMs);
        },
      );
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(retry);
    };
  }, [enabled, intervalMs, retryMs]);

  return state;
}
