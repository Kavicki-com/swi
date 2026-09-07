import { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { ProdOnlyPlaceholder } from '../../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import { activateMonitoring, useWatchDiagnostics } from '../../../services/telemetry/watchDiagnostics';
import { deriveTelemetryAvailability } from '../../../services/telemetry/telemetryAvailability';
import { telemetryCopy } from '../../../services/telemetry/telemetryCopy';
import { useNow } from '../../../services/telemetry/useNow';

// Primeira tela do primeiro uso (ADR-0003): autorizar e ativar aparecem juntas,
// mas como ações distintas, e nada acontece antes do funcionário ler o que vai
// ser lido. Nenhuma folha do sistema abre sozinha.

export default function WatchConnection() {
  if (!isFeatureEnabled('watchOnboarding')) {
    return <ProdOnlyPlaceholder />;
  }
  return <WatchConnectionScreen />;
}

function WatchConnectionScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const estado = useWatchDiagnostics();
  const [ativando, setAtivando] = useState(false);

  const semSuporte = estado.support === 'unsupported';
  const copy = telemetryCopy(deriveTelemetryAvailability(estado, useNow()), 'primeiro-uso');

  const pularParaOFim = () => router.replace('/(onboarding)/watch/complete');

  const concederEAtivar = async () => {
    setAtivando(true);
    // O resultado não decide a navegação: o iOS não conta negação de leitura
    // (ADR-0004), então quem responde se deu certo é a chegada da leitura, na
    // tela seguinte. Aqui só evitamos dois toques simultâneos.
    await activateMonitoring();
    setAtivando(false);
    router.push('/(onboarding)/watch/connection-start');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../../assets/smartband-bg-pattern.png')}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.gap.l,
          paddingHorizontal: theme.padding.m,
          paddingBottom: theme.gap.l,
          gap: theme.gap.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {semSuporte ? (
          <View style={{ gap: theme.gap.s }}>
            {/* Nao usa "indisponivel": no glossario essa palavra nomeia outro
                estado, o que tem suporte mas nao recebeu leitura, e que pede
                outro conselho. */}
            <Title variant="title.s" color={theme.content.dark}>
              {copy.titulo}
            </Title>
            <Text variant="body.m" color={theme.content.dark}>
              {copy.corpo}
            </Text>
          </View>
        ) : (
          <>
            <View style={{ gap: theme.gap.s }}>
              <Title variant="title.s" color={theme.content.dark}>
                Vamos ativar o seu
              </Title>
              <Title variant="title.l" color={theme.content.primary}>
                Apple Watch
              </Title>
              <Text variant="body.m" color={theme.content.dark}>
                O SWI vai ler batimentos, passos e energia ativa do seu Apple Watch durante o
                trabalho. Primeiro você autoriza o acesso, depois o monitoramento é ativado no
                relógio.
              </Text>
            </View>

            <View style={{ gap: theme.gap.xl, marginTop: theme.gap.l }}>
              <Title variant="title.s" color={theme.content.dark}>
                Antes de continuar:
              </Title>
              <Text variant="body.m" color={theme.content.dark}>
                1 - Deixe o Apple Watch no pulso, desbloqueado e pareado a este iPhone
              </Text>
              <Text variant="body.m" color={theme.content.dark}>
                2 - Autorize o acesso à Saúde quando o sistema perguntar
              </Text>
              <Text variant="body.m" color={theme.content.dark}>
                3 - Confirme no relógio, se ele pedir
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.padding.m,
          paddingBottom: insets.bottom + theme.gap.m,
          paddingTop: theme.gap.s,
          gap: theme.gap.sm,
        }}
      >
        {semSuporte ? (
          <Button variant="contained" label="Continuar" fullWidth onPress={pularParaOFim} />
        ) : (
          <>
            <Button
              variant="contained"
              label="Conceder e ativar"
              fullWidth
              disabled={ativando}
              onPress={() => {
                void concederEAtivar();
              }}
            />
            {/* Sem esta saída, quem ainda não pareou o relógio fica preso no
                cadastro, e gasta a única pergunta que o sistema faz. */}
            <Button
              variant="outline"
              label="Configurar depois"
              fullWidth
              disabled={ativando}
              onPress={pularParaOFim}
            />
          </>
        )}
      </View>
    </View>
  );
}
