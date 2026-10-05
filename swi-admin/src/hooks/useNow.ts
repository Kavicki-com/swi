import { useEffect, useState } from 'react'

// Relógio de tela: a hora de agora, atualizada a cada intervalo, para textos
// que envelhecem sozinhos ("última posição às") sem recarregar a página.
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
