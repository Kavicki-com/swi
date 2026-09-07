import { useEffect, useState } from 'react';

// A atualidade de uma leitura é função do relógio, não de um evento novo. Sem
// isto, uma tela aberta segue dizendo "atual" para sempre depois que o Apple
// Watch para de enviar, porque nada a faz renderizar de novo.
//
// Cinco segundos são finos o bastante para as fronteiras de 45 e 120 segundos
// sem manter a tela renderizando à toa.
const INTERVALO_PADRAO_MS = 5_000;

export function useNow(intervalMs: number = INTERVALO_PADRAO_MS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return now;
}
