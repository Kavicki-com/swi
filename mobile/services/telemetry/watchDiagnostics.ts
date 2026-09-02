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

/**
 * Autorizar e depois ativar, as duas ações que o ADR-0003 manda apresentar
 * juntas no primeiro uso. É o que o botão faz, aqui e em Configurações.
 *
 * A ativação segue mesmo quando a autorização responde false ou falha: o iOS
 * não conta negação de leitura (ADR-0004), e a folha pode já ter sido
 * respondida numa instalação anterior. Parar aqui deixaria de ativar quem já
 * tinha autorizado.
 *
 * Devolve se o monitoramento foi ativado. Nunca rejeita: a tela decide o que
 * mostrar lendo o estado derivado, não este booleano.
 */
export async function activateMonitoring(
  control: WatchControl = watchControl,
): Promise<boolean> {
  if (!control.supported) return false;
  await control.requestAuthorization().catch(() => false);
  return control.startMonitoring();
}

export function useWatchDiagnostics(control: WatchControl = watchControl): WatchDiagnosticsState {
  const [status, setStatus] = useState<SwiWatchControlStatus | null>(() => control.getStatus());

  useEffect(() => {
    if (!control.supported) return undefined;
    // Só observa. Autorizar é ação do funcionário, no botão: abrir a folha do
    // sistema ao renderizar mostraria a pergunta antes da explicação.
    setStatus(control.getStatus());
    return control.subscribe(setStatus);
  }, [control]);

  if (!control.supported || status === null) return { support: 'unsupported' };
  return { support: 'ready', ...status };
}
