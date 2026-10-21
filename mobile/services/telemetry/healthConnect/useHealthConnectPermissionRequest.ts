import { useCallback, useState } from 'react';
import type { HealthConnectMonitoringStatus } from '../telemetryCopy';
import type { HealthConnectPermission, HealthConnectState } from './healthConnectReader';
import type { HealthConnectAvailability } from './healthConnectSource';

// O pedido de permissão de leitura feito numa tela, comum ao passo do
// pareamento (HealthConnectPairingStep.tsx) e ao Monitoramento em
// Configurações (HealthConnectMonitoring.tsx).
//
// As duas telas precisam da resposta do pedido feito AQUI, e não só da
// permissão do estado: ela também vem negada de quem nunca foi perguntado, e
// só um pedido desta tela que não concedeu leva ao caminho dos ajustes.
//
// A resposta vale para o Health Connect daquele momento. Se a disponibilidade
// muda depois (a pessoa instalou ou atualizou pela Play Store depois de um
// pedido que falhou), ela deixa de valer, de vez, e a tela volta a oferecer
// o pedido. Antes isso era um `useEffect` que zerava a resposta a cada
// mudança da disponibilidade, e ele tinha uma corrida: o provider relê o
// estado ANTES de devolver a resposta, então a disponibilidade nova e a
// resposta chegam no mesmo render, e o efeito apagava a resposta que acabara
// de chegar. Aqui a resposta é guardada com a disponibilidade em que foi
// obtida (a do primeiro render depois de ela chegar, que já traz o estado
// relido) e a validade é derivada no render, sem efeito.

type Answer = HealthConnectPermission | 'unavailable';

/** A resposta e o Health Connect em que ela valeu. */
interface Registro {
  readonly answer: Answer;
  /** Falso até o primeiro render depois de a resposta chegar. */
  readonly bound: boolean;
  readonly availability: HealthConnectAvailability | null;
}

export interface HealthConnectPermissionRequest {
  /** A resposta do último pedido desta tela, enquanto ela vale; nula sem pedido. */
  answer: Answer | null;
  /** Verdadeiro enquanto o pedido do sistema está aberto. */
  requesting: boolean;
  /** Abre o pedido do sistema e guarda a resposta. Nunca rejeita. */
  request: () => Promise<void>;
}

/**
 * `availability` é a do estado do Health Connect, como a tela a lê agora.
 * `ask` é o `requestHealthConnectPermission` do contexto do envio, que nunca
 * rejeita e relê o estado antes de devolver.
 */
export function useHealthConnectPermissionRequest(
  availability: HealthConnectAvailability | null,
  ask: () => Promise<Answer>,
): HealthConnectPermissionRequest {
  const [registro, setRegistro] = useState<Registro | null>(null);
  const [requesting, setRequesting] = useState(false);

  // Ajuste do estado durante o render, o caminho que o React recomenda para
  // estado derivado de props: o React descarta este render e refaz na hora,
  // antes de pintar. O valor deste render já sai certo, e o próximo render
  // não ajusta de novo (o registro fica igual ao que se derivou aqui).
  let vigente = registro;
  if (registro !== null && !registro.bound) {
    vigente = { answer: registro.answer, bound: true, availability };
    setRegistro(vigente);
  } else if (registro !== null && registro.availability !== availability) {
    vigente = null;
    setRegistro(null);
  }

  const request = useCallback(async () => {
    setRequesting(true);
    const answer = await ask();
    setRegistro({ answer, bound: false, availability: null });
    setRequesting(false);
  }, [ask]);

  return { answer: vigente?.answer ?? null, requesting, request };
}

/**
 * Em que pé está o Health Connect para as duas telas, a partir do estado e da
 * resposta do pedido feito nelas (`answer` acima). Antes da primeira
 * conferência (disponibilidade nula) não se afirma nada. Ausente ou
 * desatualizado vale acima de qualquer resposta, e concedida acima de uma
 * resposta antiga. Sem permissão, só a resposta de um pedido daqui leva ao
 * caminho dos ajustes; o pedido que rejeitou com o Health Connect ainda
 * disponível (`'unavailable'`) pede o mesmo conselho, e não um Permitir
 * leitura mudo de novo.
 */
export function healthConnectStatusOf(
  healthConnect: HealthConnectState | null,
  answer: Answer | null,
): HealthConnectMonitoringStatus {
  const availability = healthConnect?.availability ?? null;
  if (availability === null) return 'unknown';
  if (availability !== 'available') return availability;
  if (healthConnect?.permission === 'granted') return 'granted';
  return answer === 'denied' || answer === 'unavailable'
    ? 'not_granted_after_request'
    : 'not_granted';
}
