import { useSyncExternalStore } from 'react';

// O fim da evacuação, visto por qualquer caminho: a consulta do rastreio
// (useEvacuationTracking: abertura, volta ao primeiro plano e a cada 30 s com
// evacuação ativa), o aviso do socket e a rota que volta 404 (EvacuationProvider)
// e a tarefa de localização com o app na frente. As telas de evacuação leem
// daqui para sair do modo evacuação.
//
// Fica fora do React porque a tarefa de localização, definida no carregamento
// do bundle, também avisa. Em memória: num processo novo a primeira consulta
// diz de novo o que está ativo.
//
// "Encerrada" só depois de uma ativa vista nesta sessão. Sem ela não há o que
// encerrar: o backend de demonstração nunca tem evacuação disparada, e a tela
// aberta por uma notificação antiga segue com o aviso de sempre.

let activeId: string | null = null;
let endedId: string | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/** O que o servidor disse da evacuação ativa: o id dela, ou null para nenhuma. */
export function reportActiveEvacuation(id: string | null): void {
  if (id !== null) {
    if (activeId === id && endedId === null) return;
    activeId = id;
    endedId = null;
    notify();
    return;
  }
  if (activeId === null) return;
  endedId = activeId;
  activeId = null;
  notify();
}

/**
 * O aviso de fim que traz o id (socket). Só encerra a evacuação conhecida: o
 * aviso atrasado de uma antiga não derruba a que está em curso.
 */
export function reportEvacuationEnded(id: string): void {
  if (activeId !== id) return;
  reportActiveEvacuation(null);
}

/** Sessão nova (outra pessoa logada): nada visto ainda. */
export function resetEvacuationEnd(): void {
  if (activeId === null && endedId === null) return;
  activeId = null;
  endedId = null;
  notify();
}

/** A evacuação que acabou depois de vista ativa, ou null. */
export function endedEvacuation(): string | null {
  return endedId;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** O id da evacuação encerrada, reativo. Null em curso ou sem nenhuma vista. */
export function useEndedEvacuation(): string | null {
  return useSyncExternalStore(subscribe, endedEvacuation, endedEvacuation);
}

/** Se a evacuação vista ativa nesta sessão já acabou, reativo. */
export function useEvacuationEnded(): boolean {
  return useEndedEvacuation() !== null;
}
