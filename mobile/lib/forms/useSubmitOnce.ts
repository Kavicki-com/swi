import { useCallback, useRef, useState } from 'react';

export interface SubmitOnce {
  /** Dispara a ação. Chamadas enquanto a anterior está no ar são ignoradas. */
  run: () => Promise<void>;
  /** `true` enquanto a ação está no ar — pra desabilitar o botão e dar feedback. */
  busy: boolean;
}

/**
 * Impede que um envio dispare duas vezes.
 *
 * `canSubmit` pode continuar verdadeiro enquanto a requisição está em voo.
 * Esta trava impede que toques repetidos enviem a mesma operação duas vezes,
 * inclusive em conexões lentas.
 *
 * A trava usa `useRef`, não `useState`: dois toques no mesmo frame leriam o
 * mesmo valor de estado (o re-render ainda não aconteceu) e ambos passariam. O
 * ref muda na hora. O `busy` existe só para a UI.
 */
export function useSubmitOnce(fn: () => Promise<void>): SubmitOnce {
  const emVoo = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (emVoo.current) return;
    emVoo.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      // `finally`: se a falha travasse o botão, o primeiro erro de rede
      // mataria o cadastro de vez — sem como tentar de novo. O erro segue
      // propagando pra quem chamou decidir (mostrar motivo, não navegar).
      emVoo.current = false;
      setBusy(false);
    }
  }, [fn]);

  return { run, busy };
}
