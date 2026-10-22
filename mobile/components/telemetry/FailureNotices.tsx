import { useRef, useState } from 'react';
import { Button, Surface, Text, useTheme } from '@kavicki/swi-design-system';
import { bleHeartRate, type BleHeartRate } from '../../modules/swi-ble-heart-rate/src';
import { SYNC_BANNER_COPY } from '../../services/telemetry/telemetryCopy';
import {
  failureNoticesOf,
  type AbsenceContext,
  type AbsenceMetric,
  type FailureNotice,
} from '../../services/vitals/metricAbsence';
import { useSyncAndRefresh } from '../../services/vitals/useSyncAndRefresh';

// O Falhou das telas de vitais, só no Android: um aviso por caminho que
// derrubou alguma métrica sem valor, com a hora, o motivo afirmado e o botão
// que tenta de novo. O cartão de cada métrica já diz a frase; aqui fica o que
// não cabe na coluna. Compõe Surface, Text e Button do DS.
//
// - Health Connect: "Sincronizar agora", o mesmo da faixa da pulseira.
// - Bluetooth: "Religar a escuta" pede à ponte o `start` da pulseira
//   escolhida, como o ciclo de vida da escuta faz. Quem decide quando a
//   escuta liga e desliga continua sendo o ciclo de vida.

export const RELISTEN_LABEL = 'Religar a escuta';
const RELISTENING_LABEL = 'Religando…';

export function FailureNotices({
  absent,
  context,
  ble = bleHeartRate,
}: {
  absent: readonly AbsenceMetric[];
  context: AbsenceContext | null;
  ble?: BleHeartRate;
}) {
  const notices = failureNoticesOf(absent, context);
  if (notices.length === 0) return null;
  return (
    <>
      {notices.map((notice) => (
        <FailureNoticeCard key={notice.path} notice={notice} ble={ble} />
      ))}
    </>
  );
}

function FailureNoticeCard({ notice, ble }: { notice: FailureNotice; ble: BleHeartRate }) {
  const theme = useTheme();
  return (
    <Surface
      testID={`failure-notice-${notice.path}`}
      variant="medium"
      padding="s"
      radius="m"
      // flex-start: sem ele a coluna estica o Button até a largura do aviso.
      style={{ gap: theme.gap.s, width: '100%', alignItems: 'flex-start' }}
    >
      <Text variant="body.s" color={theme.content.dark}>
        {notice.title}
      </Text>
      <Text variant="caption.s" color={theme.content.dark}>
        {notice.reason}
      </Text>
      {notice.action === 'sync' ? (
        <SyncAgain />
      ) : notice.deviceId !== null ? (
        <RelistenAgain deviceId={notice.deviceId} ble={ble} />
      ) : null}
    </Surface>
  );
}

function RetryButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Button
      variant="outline"
      size="small"
      label={label}
      borderColor={theme.content.primary}
      borderWidth="m"
      labelColor={theme.content.primary}
      disabled={disabled}
      onPress={onPress}
    />
  );
}

function SyncAgain() {
  const { paired, syncing, sincronizar } = useSyncAndRefresh();
  // Sem pareamento a sincronização não sobe nada; quem diz o que falta é a
  // lista de prontidão.
  if (!paired) return null;
  return (
    <RetryButton
      label={syncing ? SYNC_BANNER_COPY.sincronizando : SYNC_BANNER_COPY.sincronizar}
      disabled={syncing}
      onPress={sincronizar}
    />
  );
}

function RelistenAgain({ deviceId, ble }: { deviceId: string; ble: BleHeartRate }) {
  const [religando, setReligando] = useState(false);
  // Segura o toque duplo no mesmo quadro, antes de o estado mudar.
  const pedido = useRef(false);
  const religar = () => {
    if (pedido.current) return;
    pedido.current = true;
    setReligando(true);
    // Recusa (permissão, Bluetooth) não tem o que dizer aqui além do que o
    // aviso já diz: o estado da escuta, que a ponte avisa, muda o aviso.
    ble
      .start(deviceId)
      .catch(() => undefined)
      .finally(() => {
        pedido.current = false;
        setReligando(false);
      });
  };
  return (
    <RetryButton label={religando ? RELISTENING_LABEL : RELISTEN_LABEL} disabled={religando} onPress={religar} />
  );
}
