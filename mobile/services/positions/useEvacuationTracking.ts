import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getEvacuationBackend } from '../evacuation/getEvacuationBackend';
import type { ActiveEvacuationView } from '../evacuation/types';
import type { AppNotification } from '../notifications/types';
import { getPositionRuntime, type PositionTracking } from './positionTracking';
import {
  requestAlwaysPermission,
  requestTrackingPermission,
  type TrackingPermission,
} from './trackingPermission';

// Rastreio durante a evacuação. Com evacuação ativa para a pessoa logada, o
// rastreio em segundo plano liga mesmo sem jornada, e cada leitura de 10 s
// vai para o painel. Vale até o gestor ENCERRAR a evacuação no painel, e não
// até a pessoa confirmar a chegada ao ponto de encontro: quem chegou ainda
// pode precisar ser localizado.
//
// Como o app fica sabendo: a consulta de GET /evacuations/active ao abrir a
// área logada, a cada volta ao primeiro plano e quando chega a notificação de
// evacuação pelo socket. Com evacuação ativa, a consulta se repete de tempos
// em tempos para ver o encerramento; com o app em segundo plano, quem vê o
// encerramento é a tarefa de localização (backgroundLocationTask).

/** De quanto em quanto tempo, com evacuação ativa e o app aberto, consulta. */
export const EVACUATION_POLL_MS = 30_000;

export interface EvacuationTrackingDeps {
  tracking: PositionTracking;
  getActive(): Promise<ActiveEvacuationView | null>;
  askPermission(): Promise<TrackingPermission>;
  askAlways(): Promise<void>;
  /** Pedir permissão só com o app na frente: em segundo plano não há tela. */
  isForeground(): boolean;
}

const defaultDeps = (): EvacuationTrackingDeps => ({
  tracking: getPositionRuntime().tracking,
  getActive: () => getEvacuationBackend().getActive(),
  askPermission: () => requestTrackingPermission(),
  askAlways: () => requestAlwaysPermission(),
  isForeground: () => AppState.currentState === 'active',
});

/**
 * O id da notificação de evacuação mais recente, ou null. Datas ISO comparam
 * como texto (= ordem cronológica), como no resto das notificações.
 */
export function latestEvacuationNotice(
  notifications: readonly Pick<AppNotification, 'id' | 'domain' | 'createdAt'>[],
): string | null {
  let latest: Pick<AppNotification, 'id' | 'createdAt'> | null = null;
  for (const n of notifications) {
    if (n.domain !== 'evacuation') continue;
    if (!latest || n.createdAt > latest.createdAt) latest = n;
  }
  return latest?.id ?? null;
}

/**
 * Segue a evacuação ativa. Montado na área logada. `notice` muda quando chega
 * uma notificação de evacuação (o id da mais recente): é a deixa para
 * consultar na hora, sem esperar a volta ao primeiro plano.
 */
export function useEvacuationTracking(
  userId: string | null,
  notice: string | null,
  deps: EvacuationTrackingDeps = defaultDeps(),
): void {
  // As dependências mudam de identidade a cada render (o padrão é criado na
  // chamada): ficam numa ref, e os efeitos dependem só da sessão.
  const depsRef = useRef(deps);
  depsRef.current = deps;
  // A evacuação ativa conhecida, para a consulta periódica.
  const [evacuationId, setEvacuationId] = useState<string | null>(null);
  // A evacuação cujo rastreio já ligou, e a que já teve a permissão pedida:
  // consultar de novo não repete o pedido nem religa.
  const startedFor = useRef<string | null>(null);
  const askedFor = useRef<string | null>(null);

  useEffect(() => {
    startedFor.current = null;
    askedFor.current = null;
    setEvacuationId(null);
  }, [userId]);

  const check = useCallback(async () => {
    if (!userId) return;
    const { tracking, getActive, askPermission, askAlways, isForeground } = depsRef.current;
    let active: ActiveEvacuationView | null;
    try {
      active = await getActive();
    } catch {
      // Sem rede, fica como está: a evacuação gravada segue valendo.
      return;
    }
    if (!active) {
      startedFor.current = null;
      setEvacuationId(null);
      await tracking.endEvacuation();
      return;
    }
    setEvacuationId(active.id);
    if (startedFor.current === active.id || !isForeground()) return;
    // A permissão é pedida uma vez por evacuação. Negada, tenta ligar mesmo
    // assim (quem já liberou o "Sempre" antes não precisa dela agora), e a
    // volta ao primeiro plano, depois de liberar nos ajustes, tenta de novo.
    if (askedFor.current !== active.id) {
      askedFor.current = active.id;
      await askPermission();
    }
    if ((await tracking.startEvacuation(userId, active.id)) !== 'tracking') return;
    startedFor.current = active.id;
    // O "Sempre" do iPhone vem com o rastreio já ligado, como na jornada.
    void askAlways();
  }, [userId]);

  useEffect(() => {
    void check();
  }, [check, notice]);

  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [userId, check]);

  useEffect(() => {
    if (!evacuationId) return;
    const timer = setInterval(() => void check(), EVACUATION_POLL_MS);
    return () => clearInterval(timer);
  }, [evacuationId, check]);
}
