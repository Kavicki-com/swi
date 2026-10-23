import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { reportEvacuationEnded } from '../evacuation/evacuationEnd';
import { announceEvacuationPush, readEvacuationPush } from './evacuationPush';
import { getPushRegistration } from './pushRegistration';

// O push com o app aberto e o toque na notificação. Montado na área logada:
// - registra o aparelho a cada login e a cada abertura com sessão, e de novo
//   quando o sistema troca o token;
// - push da evacuação recebido com o app na frente: a notificação aparece
//   pelo handler (pushSetup) e daqui sai a deixa para o rastreio consultar
//   na hora, como a notificação do socket;
// - toque na notificação do início: abre a tela de evacuação e consulta.
//
// Com o app fechado, quem recebe é a tarefa (pushTask). O toque que abre o
// app chega aqui pela resposta guardada, lida ao montar.

/** A tela da rota de evacuação, a mesma que o alerta de evacuação abre. */
export const EVACUATION_ROUTE = '/(app)/evacuation' as const;

// Toques já tratados neste processo: a resposta guardada e a escuta podem
// entregar o mesmo toque, e o login seguinte não reabre a tela por ele.
const handled = new Set<string>();

export function usePushNotifications(userId: string | null): void {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;
    const registration = getPushRegistration();
    void registration.register();
    const sub = Notifications.addPushTokenListener((token) => {
      void registration.refresh(token);
    });
    return () => sub.remove();
  }, [userId]);

  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;

    const received = Notifications.addNotificationReceivedListener((notification) => {
      const push = readEvacuationPush(notification.request.content.data);
      if (!push) return;
      // O fim entra no aviso único (evacuationEnd), como o do socket: as telas
      // saem do modo evacuação e o rastreio encerra na hora.
      if (push.type === 'evacuation.ended') reportEvacuationEnded(push.evacuationId);
      announceEvacuationPush(notification.request.identifier);
    });

    const onResponse = (response: Notifications.NotificationResponse) => {
      const { request } = response.notification;
      const push = readEvacuationPush(request.content.data);
      if (!push || handled.has(request.identifier)) return;
      handled.add(request.identifier);
      announceEvacuationPush(request.identifier);
      if (push.type === 'evacuation.started') {
        try {
          routerRef.current.push(EVACUATION_ROUTE);
        } catch {
          // Navegação ainda não montada: a consulta já foi pedida, e o alerta
          // de evacuação do app leva à mesma tela.
        }
      }
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };
    const responses = Notifications.addNotificationResponseReceivedListener(onResponse);

    let alive = true;
    Notifications.getLastNotificationResponseAsync()
      .then((last) => {
        if (alive && last) onResponse(last);
      })
      .catch(() => undefined);

    return () => {
      alive = false;
      received.remove();
      responses.remove();
    };
  }, [userId]);
}
