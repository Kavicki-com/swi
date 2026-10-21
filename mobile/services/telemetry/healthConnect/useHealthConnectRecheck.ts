import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * Confere o acesso ao Health Connect ao montar a tela e de novo a cada volta
 * do app ao primeiro plano. Comum ao passo do pareamento
 * (HealthConnectPairingStep.tsx) e ao Monitoramento em Configurações
 * (HealthConnectMonitoring.tsx).
 *
 * Antes da primeira rodada do leitor a disponibilidade e a permissão do
 * estado são nulas: é a conferência da entrada que as preenche. A volta da
 * Play Store ou dos ajustes do Health Connect é a volta ao primeiro plano, e
 * é nela que a pessoa pode ter instalado, concedido ou revogado. Mais simples
 * que um botão de "já instalei" ou "já permiti": não pede nada da pessoa, e o
 * mesmo ouvinte cobre quem mudou por outro caminho.
 *
 * `check` é o `checkHealthConnect` do contexto do envio, que nunca rejeita.
 * Ele é estável entre renders (useCallback no provider): uma função nova a
 * cada render religaria o ouvinte e conferiria de novo à toa.
 */
export function useHealthConnectRecheck(check: () => Promise<unknown>): void {
  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void check();
    });
    return () => sub.remove();
  }, [check]);
}
