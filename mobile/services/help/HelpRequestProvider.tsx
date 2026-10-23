import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { uuid } from 'expo-modules-core';
import { useLocation } from '../location/LocationProvider';
import { getPositionsBackend } from '../positions/getPositionsBackend';
import { getHelpRequestBackend } from './getHelpRequestBackend';
import { rescuerEtaMinutes } from './rescuerEta';
import type { HelpRequestView } from './types';

// Pedido de ajuda do botão "Ajuda urgente", um só para a sessão inteira: o
// dashboard pede, e o procedimento de evacuação (aberto do dashboard ou das
// notificações) mostra em que pé o pedido está.
//
// Sem sinal, o mais seguro é não desistir do pedido: a falha aparece na tela,
// o toque tenta de novo, e o app também tenta sozinho em cadência enquanto a
// sessão estiver aberta. Toda tentativa do mesmo toque leva a MESMA chave de
// idempotência, então nenhuma delas abre um segundo pedido no servidor.

/** Intervalo da nova tentativa automática depois de uma falha de rede. */
export const HELP_RETRY_MS = 15_000;
/** Releitura do pedido aberto: o socket avisa o estado, não a posição do socorrista. */
export const HELP_REFRESH_MS = 30_000;
/**
 * Quanto o pedido espera a posição subir. Sem sinal a batida só desistiria no
 * prazo da API (20 s), e o pedido, que é o que importa, ficaria parado atrás.
 */
const HEARTBEAT_WAIT_MS = 5_000;

export interface HelpRequestState {
  /** O pedido mais recente, em qualquer estado; null se nunca pediu ou ainda não leu. */
  helpRequest: HelpRequestView | null;
  /** Um envio está em curso. */
  sending: boolean;
  /** O último envio não chegou ao servidor. Some quando um envio é confirmado. */
  failed: boolean;
  /** Minutos até o socorrista despachado chegar; null quando não há o que estimar. */
  rescuerEtaMin: number | null;
  /** Pede ajuda. Sem efeito com um envio em curso. */
  requestHelp: () => void;
}

const HelpRequestContext = createContext<HelpRequestState | null>(null);

// Falha que pode passar repetindo: sem resposta (rede, prazo), servidor fora do
// ar, ou excesso de pedidos. Recusa de verdade (sem permissão, chave inválida)
// não melhora repetindo, e repetir a cada 15 s seria só ruído no servidor.
function worthRetrying(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return true;
  return status >= 500 || status === 408 || status === 429;
}

function sendPosition(coords: [number, number]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, HEARTBEAT_WAIT_MS);
  });
  // O heartbeat é (lat, lng); o LocationProvider entrega [lng, lat].
  const beat = getPositionsBackend()
    .heartbeat(coords[1], coords[0])
    .catch(() => undefined);
  return Promise.race([beat, wait]).finally(() => clearTimeout(timer));
}

export function HelpRequestProvider({ children }: PropsWithChildren) {
  const { coords } = useLocation();
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  const [helpRequest, setHelpRequest] = useState<HelpRequestView | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const mounted = useRef(true);
  const inFlight = useRef(false);
  // Chave do toque ainda não confirmado: vale para toda nova tentativa dele.
  const pendingKey = useRef<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(() => {
    getHelpRequestBackend()
      .mine()
      .then(
        (view) => {
          if (mounted.current) setHelpRequest(view);
        },
        // Leitura que falha deixa o estado anterior: a próxima corrige.
        () => undefined,
      );
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
      clearTimeout(retryTimer.current);
    };
  }, [refresh]);

  // Pedido aberto ou atendido: segue o servidor pelo aviso do socket e por
  // releitura, que também traz a posição nova do socorrista.
  const following = helpRequest !== null && helpRequest.status !== 'CLOSED';
  useEffect(() => {
    if (!following) return;
    const unsubscribe = getHelpRequestBackend().subscribe(() => refresh());
    const timer = setInterval(refresh, HELP_REFRESH_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [following, refresh]);

  const sendRef = useRef<() => Promise<void>>(async () => undefined);
  const send = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    clearTimeout(retryTimer.current);
    if (pendingKey.current === null) pendingKey.current = uuid.v4();
    const key = pendingKey.current;
    setSending(true);
    try {
      // O pedido não leva posição: ela sobe antes, para a central ver onde a
      // pessoa está. Sem GPS o pedido sai mesmo assim, com a última conhecida.
      const at = coordsRef.current;
      if (at !== null) await sendPosition(at);
      const view = await getHelpRequestBackend().request(key);
      pendingKey.current = null;
      if (!mounted.current) return;
      setHelpRequest(view);
      setFailed(false);
    } catch (error) {
      if (!mounted.current) return;
      setFailed(true);
      if (worthRetrying(error)) {
        retryTimer.current = setTimeout(() => void sendRef.current(), HELP_RETRY_MS);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  }, []);
  sendRef.current = send;

  const requestHelp = useCallback(() => {
    void send();
  }, [send]);

  const value = useMemo<HelpRequestState>(
    () => ({
      helpRequest,
      sending,
      failed,
      rescuerEtaMin: rescuerEtaMinutes(helpRequest, coords),
      requestHelp,
    }),
    [helpRequest, sending, failed, coords, requestHelp],
  );

  return <HelpRequestContext.Provider value={value}>{children}</HelpRequestContext.Provider>;
}

export function useHelpRequest(): HelpRequestState {
  const ctx = useContext(HelpRequestContext);
  if (!ctx) throw new Error('useHelpRequest must be used inside HelpRequestProvider');
  return ctx;
}
