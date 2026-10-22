import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import type { RouteSnapshot } from './types';
import { getEvacuationBackend } from './getEvacuationBackend';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

// Por que o motivo do erro importa: 404 (nenhuma evacuação ativa com ponto de
// encontro), 409 (o backend não sabe onde a pessoa está) e falha de rede pedem
// frases diferentes na tela. Sem distinguir, a tela de segurança só saberia
// dizer "não deu".
export type RouteErrorKind = 'no-evacuation' | 'no-position' | 'failed' | null;

interface EvacuationContextValue {
  loadStatus: LoadStatus;
  route: RouteSnapshot | null;
  errorKind: RouteErrorKind;
  // `from` = posição do GPS em [lng, lat], ou null pra deixar o backend usar a
  // última posição real gravada.
  reload: (from: [number, number] | null) => Promise<void>; // busca (sempre nova)
  // Milissegundos desde a última busca, de QUALQUER tela. O freio do recálculo
  // mora aqui e não no hook: a tela inicial fica montada embaixo da tela em
  // andamento, e um freio por tela faria as duas buscarem juntas.
  msSinceLastFetch: () => number;
}

const EvacuationContext = createContext<EvacuationContextValue | null>(null);

function kindOf(err: unknown): Exclude<RouteErrorKind, null> {
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return 'no-evacuation';
  if (status === 409) return 'no-position';
  return 'failed';
}

export function EvacuationProvider({ children }: PropsWithChildren) {
  const backend = useMemo(() => getEvacuationBackend(), []);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [route, setRoute] = useState<RouteSnapshot | null>(null);
  const [errorKind, setErrorKind] = useState<RouteErrorKind>(null);
  // Espelho do estado pro reload saber, sem virar dependência, se já há linha
  // desenhada na tela.
  const hasRoute = useRef(false);
  const lastFetchAt = useRef(0);
  // Só a busca mais nova grava. Com rede ruim uma busca pode voltar depois da
  // seguinte, e o traçado velho sobrescreveria o novo.
  const seq = useRef(0);

  // Sem cache de sessão de propósito: quem chama é a tela ao ganhar foco e o
  // recálculo, e os dois querem a rota de agora. Evacuação é tela rara, então
  // não há fetch no boot.
  const reload = useCallback((from: [number, number] | null) => {
    lastFetchAt.current = Date.now();
    const mine = ++seq.current;
    // Com rota na tela o recálculo NÃO passa por 'loading': apagar a linha no
    // meio do caminho deixaria quem está caminhando sem instrução por um
    // instante. Só a primeira carga mostra o estado de carregando.
    if (!hasRoute.current) setLoadStatus('loading');
    return backend.getRoute(from).then(
      (r) => {
        if (mine !== seq.current) return;
        hasRoute.current = true;
        setRoute(r);
        setErrorKind(null);
        setLoadStatus('ready');
      },
      (err) => {
        if (mine !== seq.current) return;
        const kind = kindOf(err);
        // Falha de rede no recálculo mantém a linha: ela ainda leva ao mesmo
        // ponto de encontro, só sai de uma posição mais antiga. O próximo
        // afastamento tenta de novo.
        if (kind === 'failed' && hasRoute.current) return;
        // 404 e 409 apagam: evacuação encerrada ou ponto trocado, e traçado
        // velho guiaria a pessoa pro lugar errado com cara de informação boa.
        hasRoute.current = false;
        setRoute(null);
        setErrorKind(kind);
        setLoadStatus('error');
      }, // .then(ok,err), NÃO .finally (lição do Chat)
    );
  }, [backend]);

  const msSinceLastFetch = useCallback(() => Date.now() - lastFetchAt.current, []);

  const value = useMemo<EvacuationContextValue>(
    () => ({ loadStatus, route, errorKind, reload, msSinceLastFetch }),
    [loadStatus, route, errorKind, reload, msSinceLastFetch],
  );
  return <EvacuationContext.Provider value={value}>{children}</EvacuationContext.Provider>;
}

export function useEvacuation(): EvacuationContextValue {
  const ctx = useContext(EvacuationContext);
  if (!ctx) throw new Error('useEvacuation must be used inside EvacuationProvider');
  return ctx;
}
