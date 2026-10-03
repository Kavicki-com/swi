import { useState } from 'react';
import { Image, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, Text, Title, TopBar, useTheme } from '@kavicki/swi-design-system';
import { ProdOnlyPlaceholder } from '../../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import { completeEnrollment } from '../../../services/telemetry/deviceEnrollment';
import { pairingFailureCopy } from '../../../services/telemetry/telemetryCopy';
import { useTelemetryUploadState } from '../../../services/telemetry/TelemetryUploadProvider';

// Pareamento do iPhone com o servidor. O administrador gera o código no painel
// e o dita; aqui o funcionário digita os seis dígitos. Uma tela, dois
// caminhos: a etapa do primeiro uso, que pode ser pulada ("Parear depois" não
// é negação, o monitoramento local segue), e a entrada por Configurações,
// Monitoramento, para quem pulou, trocou de aparelho ou foi revogado.
//
// A credencial nasce e fica no Swift: esta tela só sabe se pareou.

const CODE_LENGTH = 6;
const FIM_DO_PRIMEIRO_USO = '/(onboarding)/watch/complete';

export default function WatchPairing() {
  if (!isFeatureEnabled('appleWatchPilot')) {
    return <ProdOnlyPlaceholder />;
  }
  return <WatchPairingScreen />;
}

function WatchPairingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { origem } = useLocalSearchParams<{ origem?: string }>();
  const deConfiguracoes = origem === 'configuracoes';
  const envio = useTelemetryUploadState();

  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);
  // O pareamento concluído nesta tela vale antes de o envio reler o chaveiro.
  const [concluido, setConcluido] = useState(false);
  const pareado = concluido || envio.paired;

  const aoDigitar = (texto: string) => {
    setCodigo(texto.replace(/\D/g, '').slice(0, CODE_LENGTH));
    setRecusa(null);
  };

  const parear = async () => {
    setEnviando(true);
    setRecusa(null);
    const resultado = await completeEnrollment(codigo);
    setEnviando(false);
    if (resultado.paired) {
      setConcluido(true);
      // O envio da raiz relê a credencial e começa sem remontar nada.
      envio.refreshPairing();
      return;
    }
    setRecusa(pairingFailureCopy(resultado.reason));
  };

  const seguir = () => {
    if (deConfiguracoes) router.back();
    else router.replace(FIM_DO_PRIMEIRO_USO);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../../assets/smartband-bg-pattern.png')}
        resizeMode="cover"
        accessible={false}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        bottomOffset={60}
        contentContainerStyle={{
          paddingTop: insets.top + theme.gap.l,
          paddingHorizontal: theme.padding.m,
          paddingBottom: theme.gap.l,
          gap: theme.gap.xl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {deConfiguracoes && <TopBar title="Parear aparelho" onBack={() => router.back()} />}

        {pareado ? (
          <View style={{ gap: theme.gap.s }}>
            <Title variant="title.s" color={theme.content.dark}>
              Aparelho pareado
            </Title>
            <Text variant="body.m" color={theme.content.dark}>
              As leituras do seu Apple Watch passam a ser enviadas ao servidor.
            </Text>
          </View>
        ) : (
          <>
            <View style={{ gap: theme.gap.s }}>
              <Title variant="title.s" color={theme.content.dark}>
                Parear este iPhone
              </Title>
              <Text variant="body.m" color={theme.content.dark}>
                Peça ao administrador o código de pareamento de seis dígitos, gerado no painel, e
                digite abaixo. O código vale por dez minutos.
              </Text>
            </View>

            <Input
              label="Código de pareamento"
              labelWeight="regular"
              placeholder="000000"
              keyboardType="number-pad"
              autoComplete="off"
              maxLength={CODE_LENGTH}
              value={codigo}
              onChangeText={aoDigitar}
              disabled={enviando}
              description={recusa ?? undefined}
              descriptionVariant={recusa ? 'error' : undefined}
            />
          </>
        )}
      </KeyboardAwareScrollView>

      {/* O teclado numérico do iOS não tem tecla de confirmar: o rodapé sobe
          com ele para o botão Parear seguir ao alcance. Aberto, a borda segura
          de baixo fica atrás do teclado e sai da conta. */}
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View
          style={{
            paddingHorizontal: theme.padding.m,
            paddingBottom: insets.bottom + theme.gap.m,
            paddingTop: theme.gap.s,
            gap: theme.gap.sm,
          }}
        >
          {pareado ? (
            <Button variant="contained" label="Continuar" fullWidth onPress={seguir} />
          ) : (
            <>
              <Button
                variant="contained"
                label={enviando ? 'Pareando…' : 'Parear'}
                fullWidth
                disabled={enviando || codigo.length !== CODE_LENGTH}
                onPress={() => {
                  void parear();
                }}
              />
              {!deConfiguracoes && (
                <Button
                  variant="outline"
                  label="Parear depois"
                  fullWidth
                  disabled={enviando}
                  onPress={seguir}
                />
              )}
            </>
          )}
        </View>
      </KeyboardStickyView>
    </View>
  );
}
