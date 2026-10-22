import { Button, Surface, Text, useTheme } from '@kavicki/swi-design-system';
import { healthConnectStatusOf } from '../../services/telemetry/healthConnect/useHealthConnectPermissionRequest';
import type { WorkerTelemetry } from '../../services/telemetry/myTelemetry';
import { SYNC_BANNER_COPY as COPY } from '../../services/telemetry/telemetryCopy';
import { useTelemetryUploadState } from '../../services/telemetry/TelemetryUploadProvider';
import { useNow } from '../../services/telemetry/useNow';
import { syncBannerOf } from '../../services/vitals/dashboardVitalsView';
import { useMyTelemetry } from '../../services/vitals/MyTelemetryProvider';
import { useSyncAndRefresh } from '../../services/vitals/useSyncAndRefresh';

// Faixa da pulseira lida pelo Health Connect, no Dashboard e em Minhas
// estatísticas, logo abaixo da linha de estado dos vitais: o celular Android
// só envia o que a pulseira já sincronizou com ele, e quem lê os números
// precisa saber de quando eles são. Mora fora de `app/` porque tudo ali vira
// rota no Expo Router; aqui só compõe Surface, Text e Button do DS.
//
// - Sem `sync` na leitura (iPhone, cujo relógio envia ao vivo, ou sem
//   leitura) não há faixa, e nada mais roda: nem o relógio de 5 s.
// - O botão "Sincronizar agora" só existe quando ESTE celular lê o Health
//   Connect, com a leitura concedida, e está pareado. Dado que outro
//   aparelho do mesmo funcionário sincronizou mostra só o texto; com o
//   pareamento caído ou sem a leitura o `syncNow` não sobe nada, e o botão
//   piscaria à toa.
// - Sincronizar, o progresso e a releitura de me/current no fim são os de
//   useSyncAndRefresh, os mesmos do aviso de sincronização falhada.

export function SyncBanner() {
  const { telemetry } = useMyTelemetry();
  if (!telemetry?.sync) return null;
  return <SyncBannerBody telemetry={telemetry} />;
}

function SyncBannerBody({ telemetry }: { telemetry: WorkerTelemetry }) {
  const theme = useTheme();
  // O relógio do aparelho, para o "há N min" andar com a tela aberta. Fica
  // aqui, e não na tela, para o tique de 5 s renderizar só a faixa.
  const now = useNow();
  const { healthConnect } = useTelemetryUploadState();
  const { paired, syncing, sincronizar } = useSyncAndRefresh();

  const text = syncBannerOf(telemetry, now);
  if (text === null) return null;

  // A mesma regra do Monitoramento: pareado e com a leitura concedida.
  const podeSincronizar = paired && healthConnectStatusOf(healthConnect, null) === 'granted';

  return (
    <Surface
      testID="sync-banner"
      variant="medium"
      padding="s"
      radius="m"
      // flex-start: sem ele a coluna estica o Button (sem fullWidth) até a
      // largura da faixa, e o botão pequeno viraria uma barra.
      style={{ gap: theme.gap.s, width: '100%', alignItems: 'flex-start' }}
    >
      <Text variant="body.s" color={theme.content.dark}>
        {text}
      </Text>
      {podeSincronizar ? (
        <Button
          variant="outline"
          size="small"
          label={syncing ? COPY.sincronizando : COPY.sincronizar}
          borderColor={theme.content.primary}
          borderWidth="m"
          labelColor={theme.content.primary}
          disabled={syncing}
          onPress={sincronizar}
        />
      ) : null}
    </Surface>
  );
}
