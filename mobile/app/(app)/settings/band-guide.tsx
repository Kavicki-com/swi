import { useEffect, useState } from 'react';
import { Image as RNImage, Linking, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Accordion,
  Button,
  RadioGroup,
  StatusTag,
  Text,
  Title,
  TopBar,
  useTheme,
} from '@kavicki/swi-design-system';
import { useAuth } from '../../../services/auth/AuthProvider';
import { useTelemetryUploadState } from '../../../services/telemetry/TelemetryUploadProvider';
import { useBandChoice } from '../../../services/telemetry/bluetooth/bluetoothBandChoice';
import {
  BAND_DETECTION_SOURCE_LABELS,
  detectManufacturerApp,
} from '../../../services/telemetry/bandDetection';
import {
  BAND_GUIDES,
  BAND_GUIDE_STATUS_LABELS,
  MANUFACTURER_APPS,
  OTHER_APP,
  guideStepText,
  isBandGuideId,
  type BandGuideBlock,
  type BandGuideId,
} from '../../../services/telemetry/bandGuide';
import {
  readBandGuideAnswer,
  saveBandGuideAnswer,
} from '../../../services/telemetry/bandGuideAnswer';

// Guia da pulseira, aberto de Configurações, Monitoramento: o guia de um app
// do fabricante em dois blocos, Health Connect e Bluetooth. O app vem da
// detecção (pacote que gravou no Health Connect, depois o nome que a
// pulseira escolhida anuncia) e, sem nada detectado, da resposta a "Qual é o
// app da sua pulseira?". O detectado sobrepõe a resposta e dispensa a
// pergunta; a tela mostra só o nome do app, nunca o nome anunciado.

const OPCOES = [...MANUFACTURER_APPS, OTHER_APP].map(({ id, name }) => ({ value: id, label: name }));

const nomeDoGuia = (id: BandGuideId): string =>
  id === OTHER_APP.id
    ? 'Outro app do fabricante'
    : MANUFACTURER_APPS.find((app) => app.id === id)!.name;

export default function BandGuide() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const userId = useAuth().user?.id ?? null;
  const [resposta, setResposta] = useState<BandGuideId | null>(null);

  useEffect(() => {
    if (userId === null) return;
    let vivo = true;
    void readBandGuideAnswer(userId).then((guardada) => {
      // Quem respondeu antes da leitura terminar vale mais que o guardado.
      if (vivo) setResposta((atual) => atual ?? guardada);
    });
    return () => {
      vivo = false;
    };
  }, [userId]);

  const responder = (valor: string) => {
    if (!isBandGuideId(valor)) return;
    setResposta(valor);
    if (userId !== null) void saveBandGuideAnswer(userId, valor);
  };

  const detectado = detectManufacturerApp({
    bandPackage: useTelemetryUploadState().healthConnect?.bandPackage ?? null,
    advertisedName: useBandChoice()?.name ?? null,
  });
  const escolhido: BandGuideId | null = detectado?.id ?? resposta;
  const guia = escolhido === null ? null : BAND_GUIDES[escolhido];

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/login-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.padding.xxl,
          paddingBottom: insets.bottom + theme.padding.xxl,
          paddingHorizontal: theme.padding.m,
        }}
        showsVerticalScrollIndicator={false}
      >
        <TopBar title="Guia da pulseira" onBack={() => router.back()} />

        <View style={{ gap: theme.gap.l, marginTop: theme.padding.xxl }}>
          {detectado === null && (
            <RadioGroup
              label="Qual é o app da sua pulseira?"
              options={OPCOES}
              value={resposta}
              onChange={responder}
            />
          )}

          {escolhido !== null && guia !== null && (
            <View style={{ gap: theme.gap.m }}>
              <Title variant="title.xs" color={theme.content.dark}>
                {nomeDoGuia(escolhido)}
              </Title>
              {detectado !== null && (
                <Text variant="body.s" color={theme.content.dark}>
                  {BAND_DETECTION_SOURCE_LABELS[detectado.source]}
                </Text>
              )}
              {/* A chave troca com o app: cada guia abre com os dois blocos abertos. */}
              <Bloco
                key={`${escolhido}-hc`}
                titulo="Medições pelo Health Connect"
                bloco={guia.healthConnect}
              />
              <Bloco
                key={`${escolhido}-bt`}
                titulo="Batimento ao vivo por Bluetooth"
                bloco={guia.bluetooth}
              />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Bloco({ titulo, bloco }: { titulo: string; bloco: BandGuideBlock }) {
  const theme = useTheme();
  const { link } = bloco;
  return (
    <Accordion title={titulo} defaultOpen fullWidth showIconLeft={false}>
      <View style={{ gap: theme.gap.s }}>
        {bloco.status !== null && (
          <StatusTag
            status="canceled"
            label={BAND_GUIDE_STATUS_LABELS[bloco.status]}
            numberOfLines={2}
          />
        )}
        {bloco.steps.map((passo) => (
          <Text key={passo.text} variant="body.s" color={theme.content.dark}>
            {guideStepText(passo)}
          </Text>
        ))}
        {link !== null && (
          <Button
            variant="outline"
            label="Abrir a página do fabricante"
            fullWidth
            onPress={() => {
              // Sem navegador não há o que abrir; o guia segue na tela.
              void Linking.openURL(link).catch(() => undefined);
            }}
          />
        )}
      </View>
    </Accordion>
  );
}
