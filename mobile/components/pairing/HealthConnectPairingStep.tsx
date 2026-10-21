import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, StatusTag, Text, useTheme } from '@kavicki/swi-design-system';
import { openHealthConnectInPlayStore } from '../../services/telemetry/healthConnect/playStore';
import {
  healthConnectStatusOf,
  useHealthConnectPermissionRequest,
} from '../../services/telemetry/healthConnect/useHealthConnectPermissionRequest';
import { useHealthConnectRecheck } from '../../services/telemetry/healthConnect/useHealthConnectRecheck';
import {
  bandDetectedCopy,
  HEALTH_CONNECT_PAIRING_COPY as COPY,
  healthConnectInstallCopy,
} from '../../services/telemetry/telemetryCopy';
import { useTelemetryUploadState } from '../../services/telemetry/TelemetryUploadProvider';

// Passo do Health Connect na tela de pareamento, só no Android e só depois de
// parear: a pulseira grava no Health Connect pelo app dela, e o SWI precisa
// da permissão de leitura de lá para o envio ter o que mandar. Mora fora de
// `app/` porque tudo ali vira rota no Expo Router; aqui só compõe o DS.
//
// O caminho tem três saídas, e nenhuma prende a pessoa (o Continuar da tela
// fica sempre ao alcance):
//
// - sem Health Connect, ou com ele desatualizado: a Play Store;
// - permissão não concedida: tentar de novo, ou os ajustes do Health Connect;
// - concedida: a primeira sincronização, e o que ela achou.
//
// A volta da Play Store ou dos ajustes é a volta do app ao primeiro plano, e
// é nela que o acesso (disponibilidade E permissão) é conferido de novo
// (useHealthConnectRecheck.ts, o mesmo do Monitoramento em Configurações).
// O link da Play Store também é o mesmo das duas telas (playStore.ts).
//
// Tudo passa pelo contexto do envio, que fala com o leitor ÚNICO do runtime:
// esta tela nunca importa o leitor nem a porta.

export function HealthConnectPairingStep() {
  const theme = useTheme();
  const {
    paired,
    healthConnect,
    syncNow,
    requestHealthConnectPermission,
    checkHealthConnect,
    openHealthConnectSettings,
  } = useTelemetryUploadState();

  const disponibilidade = healthConnect?.availability ?? null;
  // A resposta do pedido feito AQUI, enquanto vale para o Health Connect de
  // agora (useHealthConnectPermissionRequest.ts, o mesmo do Monitoramento).
  // A permissão do estado também pode vir negada de uma rodada, de quem nunca
  // foi perguntado: só a resposta de um pedido desta tela abre o caminho dos
  // ajustes.
  const pedido = useHealthConnectPermissionRequest(
    disponibilidade,
    requestHealthConnectPermission,
  );
  const status = healthConnectStatusOf(healthConnect, pedido.answer);
  const pedir = () => {
    void pedido.request();
  };
  const [sincronizado, setSincronizado] = useState(false);
  const sincronizou = useRef(false);

  // Antes da primeira rodada disponibilidade e permissão do estado são nulas:
  // confere o acesso ao entrar, e de novo a cada volta ao primeiro plano (a
  // Play Store, os ajustes, onde a pessoa pode ter concedido ou revogado).
  useHealthConnectRecheck(checkHealthConnect);

  const concedida = healthConnect?.permission === 'granted';

  // A primeira sincronização, uma vez: lê as 48 h na hora e mostra o que
  // achou. A permissão de segundo plano recém-concedida já passa a valer
  // antes dela, porque a releitura do estado logo depois do pedido troca o
  // objeto, e o provider reconfere o registro da tarefa quando ele muda
  // (TelemetryUploadProvider.tsx); a sincronização é reforço, porque troca o
  // `lastSyncAt` e provoca mais uma conferência. Espera o `paired` DO
  // PROVIDER, e não o desta tela: logo depois de parear ele ainda relê a
  // credencial, e até lá `syncNow` não faz nada.
  useEffect(() => {
    if (!concedida || !paired || sincronizou.current) return;
    sincronizou.current = true;
    void syncNow().then(() => setSincronizado(true));
  }, [concedida, paired, syncNow]);

  let acao: React.ReactNode = null;
  if (status === 'unavailable' || status === 'update_required') {
    const loja = healthConnectInstallCopy(status);
    acao = (
      <>
        <Text variant="body.m" color={theme.content.dark}>
          {loja.corpo}
        </Text>
        <Button
          variant="outline"
          label={loja.botao}
          fullWidth
          onPress={() => {
            void openHealthConnectInPlayStore();
          }}
        />
      </>
    );
  } else if (status === 'granted') {
    acao = !sincronizado ? (
      <StatusTag status="info" fullWidth numberOfLines={2} label={COPY.sincronizando} />
    ) : healthConnect?.bandLabel ? (
      <StatusTag
        status="accept"
        fullWidth
        numberOfLines={2}
        label={bandDetectedCopy(healthConnect.bandLabel)}
      />
    ) : healthConnect?.noBand ? (
      <>
        <StatusTag status="pending" fullWidth numberOfLines={2} label={COPY.nenhumaPulseira} />
        <Text variant="body.m" color={theme.content.dark}>
          {COPY.nenhumaPulseiraConselho}
        </Text>
      </>
    ) : (
      // Sem pulseira e sem "nenhuma pulseira": a rodada falhou em silêncio ou
      // caiu numa em voo. Uma frase neutra, para a tela não ficar muda.
      <Text variant="body.m" color={theme.content.dark}>
        {COPY.semResultado}
      </Text>
    );
  } else if (status === 'not_granted_after_request') {
    // Também o pedido que rejeitou com o Health Connect ainda disponível (a
    // conferência do provider não o achou ausente): o conselho é o mesmo de
    // sem permissão, e não um "Permitir leitura" mudo de novo.
    acao = (
      <>
        <Text variant="body.m" color={theme.content.dark}>
          {COPY.semPermissao}
        </Text>
        <Button
          variant="outline"
          label={COPY.tentarDeNovo}
          fullWidth
          disabled={pedido.requesting}
          onPress={pedir}
        />
        <Button
          variant="ghost"
          label={COPY.abrirAjustes}
          fullWidth
          onPress={openHealthConnectSettings}
        />
      </>
    );
  } else if (status === 'not_granted') {
    acao = (
      <Button
        variant="outline"
        label={COPY.permitir}
        fullWidth
        disabled={pedido.requesting}
        onPress={pedir}
      />
    );
  }

  return (
    <View style={{ gap: theme.gap.m }}>
      <Text variant="body.m" color={theme.content.dark}>
        {COPY.explicacao}
      </Text>
      {acao}
    </View>
  );
}
