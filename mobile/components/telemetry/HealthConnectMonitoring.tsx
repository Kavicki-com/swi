import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, StatusTag, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { openHealthConnectInPlayStore } from '../../services/telemetry/healthConnect/playStore';
import {
  healthConnectStatusOf,
  useHealthConnectPermissionRequest,
} from '../../services/telemetry/healthConnect/useHealthConnectPermissionRequest';
import { useHealthConnectRecheck } from '../../services/telemetry/healthConnect/useHealthConnectRecheck';
import {
  bandDetectedCopy,
  HEALTH_CONNECT_MONITORING_COPY as COPY,
  HEALTH_CONNECT_PAIRING_COPY as PAIRING,
  healthConnectInstallCopy,
  healthConnectMonitoringCopy,
  lastSyncCopy,
  SYNC_BANNER_COPY as SYNC,
  telemetryUploadCopy,
} from '../../services/telemetry/telemetryCopy';
import { useTelemetryUploadState } from '../../services/telemetry/TelemetryUploadProvider';
import { useNow } from '../../services/telemetry/useNow';

// O Monitoramento em Configurações no Android com o gate do Health Connect,
// no lugar do bloco do Apple Watch: a pulseira grava no Health Connect pelo
// app dela, e o SWI lê de lá. Mora fora de `app/` porque tudo ali vira rota
// no Expo Router; aqui só compõe o DS.
//
// O que a tela mostra, de cima para baixo:
//
// - o estado do Health Connect, com a ação de cada um: a Play Store (ausente
//   ou desatualizado), Permitir leitura (sem permissão) e, depois de um
//   pedido daqui que não concedeu, Tentar de novo e os ajustes do Health
//   Connect. Antes de a primeira conferência voltar, só "conferindo";
// - com a leitura permitida, a pulseira detectada (ou nenhuma);
// - a última sincronização, andando com o relógio (useNow);
// - o envio, e Parear aparelho para quem não pareou;
// - pareado e com a leitura permitida: Sincronizar agora e, com pulseira
//   detectada, Redetectar.
//
// A conferência ao entrar e na volta ao primeiro plano (a Play Store, os
// ajustes), o link da Play Store e o pedido de permissão com o estado que
// sai dele são os mesmos do passo do pareamento (useHealthConnectRecheck.ts,
// playStore.ts, useHealthConnectPermissionRequest.ts). Tudo passa pelo
// contexto do envio, que fala com o leitor ÚNICO do runtime.

export function HealthConnectMonitoring({ onPair }: { onPair: () => void }) {
  const theme = useTheme();
  const now = useNow();
  const {
    paired,
    healthConnect,
    syncNow,
    syncing,
    requestHealthConnectPermission,
    checkHealthConnect,
    openHealthConnectSettings,
    redetectBand,
  } = useTelemetryUploadState();

  useHealthConnectRecheck(checkHealthConnect);

  // A resposta do pedido feito AQUI, enquanto vale para o Health Connect de
  // agora, e o estado que sai dela: os mesmos do passo do pareamento
  // (useHealthConnectPermissionRequest.ts). A permissão do estado também vem
  // negada de quem nunca foi perguntado, e só um pedido desta tela leva ao
  // caminho dos ajustes.
  const pedido = useHealthConnectPermissionRequest(
    healthConnect?.availability ?? null,
    requestHealthConnectPermission,
  );
  const pedir = () => {
    void pedido.request();
  };
  const [redetectando, setRedetectando] = useState(false);
  const [falhaRedetectar, setFalhaRedetectar] = useState(false);
  // A redetecção em curso. É ela que segura o toque duplo no mesmo quadro:
  // os dois toques veem o mesmo `redetectando` falso, porque o estado só
  // muda no render seguinte.
  const redeteccao = useRef(false);

  const status = healthConnectStatusOf(healthConnect, pedido.answer);
  const copy = healthConnectMonitoringCopy(status);
  const concedida = status === 'granted';
  const bandLabel = healthConnect?.bandLabel ?? null;
  // Sem a leitura permitida (Health Connect ausente, sem permissão, ou ainda
  // conferindo) a rodada não lê nada, e o botão primário só piscaria. Sem
  // pareamento o `syncNow` é inerte.
  const podeSincronizar = paired && concedida;
  // Só com pulseira detectada: a conhecida fica até a pessoa pedir, e é esse
  // o caminho de quem trocou de pulseira. Com "nenhuma pulseira" o leitor já
  // procura de novo a cada rodada, e Sincronizar agora procura na hora; antes
  // do primeiro resultado não há o que esquecer. Exige o mesmo que
  // sincronizar, porque é a sincronização logo depois que detecta de novo.
  const podeRedetectar = podeSincronizar && bandLabel !== null;
  const ocupado = syncing || redetectando;

  // Esquecer e logo sincronizar: a rodada forçada relê as 48 h e detecta na
  // hora, em vez de na próxima rodada do envio. `redetectBand` e `syncNow`
  // nunca rejeitam; o `finally` é para a tela nunca ficar presa.
  const redetectar = async () => {
    if (redeteccao.current) return;
    redeteccao.current = true;
    setRedetectando(true);
    setFalhaRedetectar(false);
    try {
      if (await redetectBand()) await syncNow();
      else setFalhaRedetectar(true);
    } finally {
      redeteccao.current = false;
      setRedetectando(false);
    }
  };

  let acao: React.ReactNode = null;
  if (status === 'unavailable' || status === 'update_required') {
    acao = (
      <Button
        variant="outline"
        label={healthConnectInstallCopy(status).botao}
        fullWidth
        onPress={() => {
          void openHealthConnectInPlayStore();
        }}
      />
    );
  } else if (status === 'not_granted') {
    acao = (
      <Button
        variant="outline"
        label={PAIRING.permitir}
        fullWidth
        disabled={pedido.requesting}
        onPress={pedir}
      />
    );
  } else if (status === 'not_granted_after_request') {
    acao = (
      <>
        <Button
          variant="outline"
          label={PAIRING.tentarDeNovo}
          fullWidth
          disabled={pedido.requesting}
          onPress={pedir}
        />
        <Button
          variant="ghost"
          label={PAIRING.abrirAjustes}
          fullWidth
          onPress={openHealthConnectSettings}
        />
      </>
    );
  }

  // A pulseira só com a leitura permitida: sem ela nada é lido, e uma
  // pulseira guardada de antes pareceria em uso. Sem resultado ainda não se
  // afirma nada; com uma leitura em curso, diz que procura.
  let pulseira: React.ReactNode = null;
  if (concedida && bandLabel !== null) {
    pulseira = (
      <StatusTag status="accept" fullWidth numberOfLines={2} label={bandDetectedCopy(bandLabel)} />
    );
  } else if (concedida && healthConnect?.noBand) {
    pulseira = (
      <>
        <StatusTag status="pending" fullWidth numberOfLines={2} label={PAIRING.nenhumaPulseira} />
        <Text variant="body.s" color={theme.content.dark}>
          {PAIRING.nenhumaPulseiraConselho}
        </Text>
      </>
    );
  } else if (concedida && ocupado) {
    pulseira = (
      <StatusTag status="info" fullWidth numberOfLines={2} label={PAIRING.sincronizando} />
    );
  }

  return (
    <View style={{ gap: theme.gap.l }}>
      <View style={{ gap: theme.gap.s }}>
        <Title variant="title.xs" color={theme.content.dark}>
          {copy.titulo}
        </Title>
        <Text variant="body.s" color={theme.content.dark}>
          {copy.corpo}
        </Text>
      </View>

      {acao !== null && <View style={{ gap: theme.gap.s }}>{acao}</View>}

      {pulseira !== null && <View style={{ gap: theme.gap.s }}>{pulseira}</View>}

      {/* O `lastSyncAt` vem do arquivo do leitor: é um fato mesmo com o
          Health Connect fora agora, e diz de quando é o último dado. */}
      {healthConnect !== null && (
        <Text variant="body.s" color={theme.content.dark}>
          {lastSyncCopy(healthConnect.lastSyncAt, now)}
        </Text>
      )}

      <Text variant="body.s" color={theme.content.dark}>
        {telemetryUploadCopy(paired)}
      </Text>

      {!paired && (
        <Button variant="outline" label="Parear aparelho" fullWidth onPress={onPair} />
      )}

      {podeSincronizar && (
        <Button
          variant="contained"
          label={syncing ? SYNC.sincronizando : SYNC.sincronizar}
          fullWidth
          disabled={ocupado}
          onPress={() => {
            void syncNow();
          }}
        />
      )}

      {podeRedetectar && (
        <Button
          variant="outline"
          label={COPY.redetectar}
          fullWidth
          disabled={ocupado}
          onPress={() => {
            void redetectar();
          }}
        />
      )}

      {/* Junto com o botão: a frase pede para tentar de novo, e sem ele
          (permissão revogada, pulseira esquecida) ficaria sem ação. */}
      {falhaRedetectar && podeRedetectar && (
        <Text variant="body.s" color={theme.content.error}>
          {COPY.falhaRedetectar}
        </Text>
      )}
    </View>
  );
}
