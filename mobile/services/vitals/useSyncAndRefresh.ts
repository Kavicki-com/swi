import { useRef } from 'react';
import { useTelemetryUploadState } from '../telemetry/TelemetryUploadProvider';
import { useRefreshMyTelemetry } from './MyTelemetryProvider';

// O "Sincronizar agora" das telas de vitais: a faixa da pulseira (SyncBanner)
// e o aviso de sincronização falhada (FailureNotices) fazem o mesmo.
//
// - O progresso é o `syncing` do contexto do envio, um estado só: com Minhas
//   estatísticas empilhada sobre o Dashboard as duas telas mostram o mesmo,
//   e uma sincronização começada noutro lugar também aparece aqui.
// - No fim me/current é relido na hora, porque o "sincronizado há" e a
//   ausência de cada métrica vêm do backend e só mudam numa leitura nova.
//   Relê só quem pediu, e uma vez por sincronização (ver `pedida`).

export interface SyncAndRefresh {
  /** Com o pareamento caído o `syncNow` não sobe nada: o botão some. */
  paired: boolean;
  syncing: boolean;
  sincronizar: () => void;
}

export function useSyncAndRefresh(): SyncAndRefresh {
  const { paired, syncing, syncNow } = useTelemetryUploadState();
  const refresh = useRefreshMyTelemetry();
  // A sincronização que ESTE botão pediu e ainda não terminou. É ela que
  // segura o toque duplo no mesmo quadro: os dois toques veem o mesmo
  // `syncing` falso, porque o estado só muda no render seguinte. Não é flag
  // de montagem: nada aqui escreve estado, então StrictMode e Fast Refresh
  // não deixam o botão preso em "Sincronizando…".
  const pedida = useRef<Promise<void> | null>(null);

  const sincronizar = () => {
    if (syncing || pedida.current !== null) return;
    const run = syncNow();
    pedida.current = run;
    // `syncNow` nunca rejeita; o segundo braço só impede uma rejeição solta
    // se isso mudar um dia.
    run
      .then(
        () => refresh(),
        () => undefined,
      )
      .finally(() => {
        pedida.current = null;
      });
  };

  return { paired, syncing, sincronizar };
}
