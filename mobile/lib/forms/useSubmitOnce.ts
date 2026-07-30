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
 * POR QUE EXISTE: as telas de (auth) só tinham `disabled={!canSubmit}`, e
 * `canSubmit` continua verdadeiro enquanto a requisição está no ar. No fim do
 * cadastro isso produzia uma sequência confusa (QA no aparelho, 2026-07-27):
 * o 1º toque criava a conta (201) e navegava pra tela do código; o 2º, ainda
 * em voo, recebia 409 e mostrava "E-mail já cadastrado" por cima. O código
 * chegava e funcionava — mas a pessoa acabava de ler que o e-mail já existia.
 *
 * Pela rede do QA (túnel) a janela entre os dois toques é larga.
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
