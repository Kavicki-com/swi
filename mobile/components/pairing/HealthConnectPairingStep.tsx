import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { Button, StatusTag, Text, useTheme } from '@kavicki/swi-design-system';
import type { HealthConnectPermission } from '../../services/telemetry/healthConnect/healthConnectReader';
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
// é nela que o acesso (disponibilidade E permissão) é conferido de novo.
// Mais simples que um botão de "já instalei" ou "já permiti": não pede nada
// da pessoa, e o mesmo ouvinte cobre quem mudou por outro caminho.
//
// Tudo passa pelo contexto do envio, que fala com o leitor ÚNICO do runtime:
// esta tela nunca importa o leitor nem a porta.

const HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata';
const PLAY_STORE_APP = `market://details?id=${HEALTH_CONNECT_PACKAGE}`;
const PLAY_STORE_WEB = `https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PACKAGE}`;

// O link do market só abre com o app da Play Store no aparelho; sem ele, a
// mesma página no navegador. Sem nenhum dos dois não há o que fazer, e a
// pessoa segue pelo Continuar.
const abrirPlayStore = () => {
  Linking.openURL(PLAY_STORE_APP)
    .catch(() => Linking.openURL(PLAY_STORE_WEB))
    .catch(() => undefined);
};

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

  const [pedindo, setPedindo] = useState(false);
  // A resposta do pedido feito AQUI. A permissão do estado também pode vir
  // negada de uma rodada, de quem nunca foi perguntado: só a resposta de um
  // pedido desta tela abre o caminho dos ajustes.
  const [resposta, setResposta] = useState<HealthConnectPermission | 'unavailable' | null>(null);
  const [sincronizado, setSincronizado] = useState(false);
  const sincronizou = useRef(false);

  // Antes da primeira rodada disponibilidade e permissão do estado são nulas:
  // confere o acesso ao entrar, e de novo a cada volta ao primeiro plano (a
  // Play Store, os ajustes, onde a pessoa pode ter concedido ou revogado).
  // Nunca rejeita.
  useEffect(() => {
    void checkHealthConnect();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void checkHealthConnect();
    });
    return () => sub.remove();
  }, [checkHealthConnect]);

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

  const pedir = async () => {
    setPedindo(true);
    setResposta(await requestHealthConnectPermission());
    setPedindo(false);
  };

  const disponibilidade = healthConnect?.availability ?? null;

  // A resposta de um pedido vale para o Health Connect daquele momento. Se a
  // disponibilidade muda (a pessoa instalou ou atualizou pela Play Store
  // depois de um pedido que falhou), ela deixa de valer: a permissão do
  // estado vem negada por nunca ter sido perguntada, e a tela volta a
  // oferecer o pedido em vez do caminho dos ajustes.
  useEffect(() => {
    setResposta(null);
  }, [disponibilidade]);

  let acao: React.ReactNode = null;
  if (disponibilidade === 'unavailable' || disponibilidade === 'update_required') {
    const loja = healthConnectInstallCopy(disponibilidade);
    acao = (
      <>
        <Text variant="body.m" color={theme.content.dark}>
          {loja.corpo}
        </Text>
        <Button variant="outline" label={loja.botao} fullWidth onPress={abrirPlayStore} />
      </>
    );
  } else if (disponibilidade === 'available' && concedida) {
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
  } else if (
    disponibilidade === 'available' &&
    // Pedido que rejeitou com o Health Connect ainda disponível (a
    // conferência do provider não o achou ausente): o conselho é o mesmo de
    // sem permissão, e não um "Permitir leitura" mudo de novo.
    (resposta === 'denied' || resposta === 'unavailable')
  ) {
    acao = (
      <>
        <Text variant="body.m" color={theme.content.dark}>
          {COPY.semPermissao}
        </Text>
        <Button
          variant="outline"
          label={COPY.tentarDeNovo}
          fullWidth
          disabled={pedindo}
          onPress={() => {
            void pedir();
          }}
        />
        <Button
          variant="ghost"
          label={COPY.abrirAjustes}
          fullWidth
          onPress={openHealthConnectSettings}
        />
      </>
    );
  } else if (disponibilidade === 'available') {
    acao = (
      <Button
        variant="outline"
        label={COPY.permitir}
        fullWidth
        disabled={pedindo}
        onPress={() => {
          void pedir();
        }}
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
