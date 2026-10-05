// Aviso de que um alerta foi reconhecido ou resolvido neste painel. O servidor
// não emite nada na triagem; o aviso de alerta urgente escuta aqui para sumir
// na hora, em vez de esperar a próxima releitura.
const listeners = new Set<() => void>()

export function notifyAlertTriaged(): void {
  for (const l of [...listeners]) l()
}

export function onAlertTriaged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
