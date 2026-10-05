// A lista do sino está aberta? A lista abre sob o sino, alinhada à direita, e
// passa da metade da tela; o aviso de alerta urgente fica centralizado logo
// abaixo do cabeçalho. Os dois disputariam o mesmo lugar, então o aviso sai da
// frente enquanto a lista está aberta e volta quando ela fecha.
import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()

export function setBellOpen(next: boolean): void {
  if (next === open) return
  open = next
  for (const l of [...listeners]) l()
}

export function isBellOpen(): boolean {
  return open
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useBellOpen(): boolean {
  return useSyncExternalStore(subscribe, isBellOpen)
}
