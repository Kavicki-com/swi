import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { hasToken } from '../api/http';
import type { JourneyState } from '../journey/types';
import { getPositionRuntime, type PositionTracking } from './positionTracking';

// Quando o rastreio em segundo plano liga e desliga. As regras combinadas:
// só com a jornada em andamento ou pausada; para ao encerrar a jornada, no
// logout ou depois de 12 h (as 12 h ficam com a janela, no controle).

const defaultTracking = () => getPositionRuntime().tracking;

/**
 * Segue a jornada. Montado dentro do JourneyProvider. `journeyKnown` é falso
 * até a jornada carregar: o estado inicial do provider é ocioso, e agir sobre
 * ele desligaria o rastreio a cada abertura do app.
 *
 * `source`: jornada vinda da cópia guardada (app aberto sem sinal) desliga o
 * rastreio quando ociosa, mas só RETOMA a janela que já estava aberta. Abrir
 * janela nova, e com ela 12 h de rastreio, fica para a leitura do servidor.
 */
export function useJourneyTracking(
  userId: string | null,
  journeyState: JourneyState,
  journeyKnown: boolean,
  tracking: PositionTracking = defaultTracking(),
  source: 'server' | 'cache' = 'server',
): void {
  const tracks = journeyState !== 'idle';
  useEffect(() => {
    if (!userId || !journeyKnown) return;
    if (!tracks) {
      void tracking.stop();
      return;
    }
    const turnOn = () => (source === 'cache' ? tracking.resume(userId) : tracking.start(userId));
    void turnOn();
    // Ligar pode falhar por falta de permissão, e quem a libera nos ajustes
    // volta ao app pelo primeiro plano: é a hora de tentar de novo. Com as
    // leituras já ligadas, o pedido não faz nada.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void turnOn();
    });
    // Desmontar não desliga: o layout autenticado desmonta no logout, e quem
    // desliga ali é a sessão (useTrackingSession), que vê o logout de fato.
    return () => sub.remove();
  }, [userId, tracks, journeyKnown, tracking, source]);
}

/**
 * Segue a sessão. Montado na raiz, fora do layout autenticado, porque é ali
 * que o logout é visto. Também reenvia o que a fila guardou ao abrir o app e
 * a cada volta ao primeiro plano: pontos que ficaram depois do fim da jornada
 * não teriam outra chance de sair.
 */
export function useTrackingSession(
  userId: string | null,
  restoring: boolean,
  tracking: PositionTracking = defaultTracking(),
  tokenExists: () => Promise<boolean> = hasToken,
): void {
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = userId;
    if (before && !userId) void tracking.stop();
  }, [userId, tracking]);

  // App aberto sem sessão. Se o token também não existe mais (expirou, ou a
  // conta foi desativada, e ele foi apagado), o rastreio que vinha de antes
  // desliga. Com o token guardado não: sem rede a sessão só não pôde ser
  // confirmada, e a jornada pode estar em andamento.
  useEffect(() => {
    if (restoring || userId) return;
    let alive = true;
    tokenExists().then(
      (exists) => {
        if (alive && !exists) void tracking.stop();
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [restoring, userId, tracking, tokenExists]);

  useEffect(() => {
    if (!userId) return;
    void tracking.drain(userId);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void tracking.drain(userId);
    });
    return () => sub.remove();
  }, [userId, tracking]);
}
