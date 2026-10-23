import { useCallback } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';

/**
 * Quanto tempo o aviso "Evacuação encerrada" fica na tela antes de voltar ao
 * início: o bastante para ler a frase, curto para quem já guardou o celular.
 */
export const ENDED_NOTICE_MS = 4_000;

/**
 * Com a evacuação encerrada, volta ao início depois do aviso. Devolve o
 * "voltar agora" do botão do aviso.
 *
 * Só a tela em foco sai: as duas telas de evacuação ficam empilhadas, e duas
 * navegações juntas brigariam. A de baixo, se voltar ao foco depois, sai
 * também. `navigate` volta ao dashboard que já está na pilha, como o botão
 * Home, em vez de montar outro por cima.
 */
export function useLeaveWhenEvacuationEnds(ended: boolean): () => void {
  const router = useRouter();
  const leave = useCallback(() => router.navigate('/(app)/dashboard'), [router]);
  useFocusEffect(
    useCallback(() => {
      if (!ended) return undefined;
      const timer = setTimeout(leave, ENDED_NOTICE_MS);
      return () => clearTimeout(timer);
    }, [ended, leave]),
  );
  return leave;
}
