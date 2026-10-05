import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toast, useTheme } from '@kavicki/swi-design-system';
import { refusalMessage, refusalTitle } from '../../services/outbox/sendCopy';
import type { RefusedSend } from '../../services/outbox/sendQueue';
import { useSendQueueEvent, useSendQueueSession } from '../../services/outbox/useSendQueue';

// A fila de envios na área autenticada, montada uma vez na raiz dela.
//
// Faz duas coisas: liga a fila à sessão de quem está logado (o envio segue com
// qualquer tela aberta) e mostra o aviso do envio recusado. O aviso precisa
// valer em qualquer tela: a recusa chega segundos ou horas depois do toque,
// quando a pessoa já saiu da tela em que enviou.
//
// O Toast é o do DS, como está. Ele é um bloco comum, então esta moldura só o
// posiciona por cima da tela; `box-none` deixa o toque passar para o que está
// embaixo.
export function SendQueueRoot({ userId }: { userId: string }) {
  useSendQueueSession(userId);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [refusal, setRefusal] = useState<RefusedSend | null>(null);

  useSendQueueEvent((event) => {
    if (event.type === 'refused') setRefusal({ item: event.item, reason: event.reason });
  });

  if (!refusal) return null;

  return (
    <View
      testID="send-queue-refusal"
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + theme.padding.s,
        left: theme.padding.m,
        right: theme.padding.m,
      }}
    >
      <Toast
        variant="error"
        title={refusalTitle(refusal.item)}
        message={refusalMessage(refusal.reason)}
        onClose={() => setRefusal(null)}
      />
    </View>
  );
}
