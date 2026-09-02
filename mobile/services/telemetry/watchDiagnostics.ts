import { useEffect, useState } from 'react';
import {
  watchControl,
  type SwiWatchControlStatus,
  type WatchControl,
} from '../../modules/swi-watch-control';

// Estado da tela diagnóstica do piloto Apple Watch (Task 1). Não há dado
// sintético: sem módulo nativo a tela diz "sem suporte", e sem amostra o BPM
// fica null. O controle é injetável para os testes dublarem o módulo.
export type WatchDiagnosticsState =
  | { support: 'unsupported' }
  | ({ support: 'ready' } & SwiWatchControlStatus);

export function useWatchDiagnostics(control: WatchControl = watchControl): WatchDiagnosticsState {
  const [status, setStatus] = useState<SwiWatchControlStatus | null>(() => control.getStatus());

  useEffect(() => {
    if (!control.supported) return undefined;
    setStatus(control.getStatus());
    return control.subscribe(setStatus);
  }, [control]);

  if (!control.supported || status === null) return { support: 'unsupported' };
  return { support: 'ready', ...status };
}
