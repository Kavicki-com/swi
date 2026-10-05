import { useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toast, useTheme } from '@kavicki/swi-design-system';
import { batteryLowCopy, batteryLowOf, pickRootNotice } from '../../services/outbox/rootNotice';
import {
  OFFLINE_PENDING_TITLE,
  OFFLINE_TITLE,
  refusalMessage,
  refusalTitle,
} from '../../services/outbox/sendCopy';
import type { RefusedSend } from '../../services/outbox/sendQueue';
import {
  useSendQueueEvent,
  useSendQueueSession,
  useSendQueueState,
} from '../../services/outbox/useSendQueue';
import { useConnectionLost } from '../../services/realtime/useConnection';
import { useMyTelemetry } from '../../services/vitals/MyTelemetryProvider';

// A fila de envios na área autenticada, montada uma vez na raiz dela.
//
// Faz duas coisas: liga a fila à sessão de quem está logado (o envio segue com
// qualquer tela aberta) e mostra o aviso geral, um por vez: o envio recusado,
// a falta de conexão e a bateria baixa do relógio. O aviso precisa valer em
// qualquer tela: a recusa chega segundos ou horas depois do toque, e a queda
// e a bateria não dependem de onde a pessoa está.
//
// O Toast é o do DS, como está. Ele é um bloco comum, então esta moldura só o
// posiciona por cima da tela; `box-none` deixa o toque passar para o que está
// embaixo.
export function SendQueueRoot({ userId }: { userId: string }) {
  useSendQueueSession(userId);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [refusal, setRefusal] = useState<RefusedSend | null>(null);
  const offline = useConnectionLost();
  const { stalled } = useSendQueueState();
  const battery = batteryLowOf(useMyTelemetry().telemetry);

  // Fechar vale até o estado acabar: a queda seguinte, a fila que para de novo
  // e a condição reaberta avisam outra vez.
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const [pendingDismissed, setPendingDismissed] = useState(false);
  const [batteryDismissed, setBatteryDismissed] = useState<string | null>(null);
  if (!offline && offlineDismissed) setOfflineDismissed(false);
  if (!stalled && pendingDismissed) setPendingDismissed(false);

  useSendQueueEvent((event) => {
    if (event.type === 'refused') setRefusal({ item: event.item, reason: event.reason });
  });

  const notice = pickRootNotice({
    refused: refusal !== null,
    offline,
    stalled,
    battery: battery !== null,
    dismissed: {
      offline: offlineDismissed,
      pending: pendingDismissed,
      battery: battery !== null && batteryDismissed === battery.key,
    },
  });
  if (!notice) return null;

  let toast: ReactElement;
  if (notice.kind === 'refused' && refusal) {
    toast = (
      <Toast
        variant="error"
        title={refusalTitle(refusal.item)}
        message={refusalMessage(refusal.reason)}
        onClose={() => setRefusal(null)}
      />
    );
  } else if (notice.kind === 'offline') {
    toast = notice.pending ? (
      <Toast variant="warning" title={OFFLINE_PENDING_TITLE} onClose={() => setPendingDismissed(true)} />
    ) : (
      <Toast variant="warning" title={OFFLINE_TITLE} onClose={() => setOfflineDismissed(true)} />
    );
  } else if (battery) {
    const copy = batteryLowCopy(battery.percent);
    toast = (
      <Toast
        variant="warning"
        title={copy.title}
        message={copy.message}
        onClose={() => setBatteryDismissed(battery.key)}
      />
    );
  } else {
    return null;
  }

  return (
    <View
      testID="send-queue-notice"
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + theme.padding.s,
        left: theme.padding.m,
        right: theme.padding.m,
      }}
    >
      {toast}
    </View>
  );
}
