import { useRef } from 'react';
import { Button, Surface, Text, useTheme } from '@kavicki/swi-design-system';
import { healthConnectStatusOf } from '../../services/telemetry/healthConnect/useHealthConnectPermissionRequest';
import type { WorkerTelemetry } from '../../services/telemetry/myTelemetry';
import { SYNC_BANNER_COPY as COPY } from '../../services/telemetry/telemetryCopy';
import { useTelemetryUploadState } from '../../services/telemetry/TelemetryUploadProvider';
import { useNow } from '../../services/telemetry/useNow';
import { syncBannerOf } from '../../services/vitals/dashboardVitalsView';
import { useMyTelemetry, useRefreshMyTelemetry } from '../../services/vitals/MyTelemetryProvider';

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
// - O progresso é o `syncing` do contexto do envio, um estado só: com Minhas
//   estatísticas empilhada sobre o Dashboard as duas faixas mostram o mesmo,
//   e uma sincronização começada noutro lugar também aparece aqui.
// - No fim me/current é relido na hora, porque o "sincronizado há" vem do
//   backend e só muda numa leitura nova. Relê só a faixa que pediu, e uma vez
//   por sincronização (ver `pedida`).

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
  const { healthConnect, paired, syncing, syncNow } = useTelemetryUploadState();
  const refresh = useRefreshMyTelemetry();
  // A sincronização que ESTA faixa pediu e ainda não terminou. É ela que
  // segura o toque duplo no mesmo quadro: os dois toques veem o mesmo
  // `syncing` falso, porque o estado só muda no render seguinte. Não é flag
  // de montagem: nada aqui escreve estado, então StrictMode e Fast Refresh
  // não deixam a faixa presa em "Sincronizando…".
  const pedida = useRef<Promise<void> | null>(null);

  const text = syncBannerOf(telemetry, now);
  if (text === null) return null;

  // A mesma regra do Monitoramento: pareado e com a leitura concedida.
  const podeSincronizar = paired && healthConnectStatusOf(healthConnect, null) === 'granted';

  const sincronizar = () => {
    if (syncing || pedida.current !== null) return;
    const run = syncNow();
    pedida.current = run;
    // `syncNow` nunca rejeita; o segundo braço só impede uma rejeição solta
    // se isso mudar um dia.
    run
      .then(
        () => refresh(),
        () => undefined,
      )
      .finally(() => {
        pedida.current = null;
      });
  };

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
