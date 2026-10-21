import { useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, Text, Title, TopBar, useTheme } from '@kavicki/swi-design-system';
import { HealthConnectPairingStep } from '../../../components/pairing/HealthConnectPairingStep';
import { ProdOnlyPlaceholder } from '../../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import { androidDeviceControl } from '../../../services/telemetry/android/androidDeviceControl';
import { completeEnrollment, type PhoneKind } from '../../../services/telemetry/deviceEnrollment';
import { pairingCopy, pairingFailureCopy } from '../../../services/telemetry/telemetryCopy';
import { useTelemetryUploadState } from '../../../services/telemetry/TelemetryUploadProvider';

// Pareamento do celular com o servidor. O administrador gera o código no
// painel e o dita; aqui o funcionário digita os seis dígitos. Uma tela, dois
// caminhos: a etapa do primeiro uso, que pode ser pulada ("Parear depois" não
// é negação, o monitoramento local segue), e a entrada por Configurações,
// Monitoramento, para quem pulou, trocou de aparelho ou foi revogado.
//
// Dois aparelhos, a mesma tela. No iPhone (piloto do Apple Watch) a
// credencial nasce e fica no Swift. No Android (pulseira pelo Health
// Connect) ela fica no SecureStore, pelo controle do Android
// (androidDeviceControl.ts), e depois de parear vem o passo do Health
// Connect: a permissão de leitura e a primeira sincronização. Nos dois, esta
// tela só sabe se pareou; no Android, ela ainda avisa o leitor do Health
// Connect do pareamento novo, antes de o envio reler a credencial.

const CODE_LENGTH = 6;
const FIM_DO_PRIMEIRO_USO = '/(onboarding)/watch/complete';

export default function WatchPairing() {
  if (!isFeatureEnabled('appleWatchPilot') && !isFeatureEnabled('healthConnect')) {
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
  // A plataforma conferida junto do gate, como no provider: é ela que decide
  // o caminho, e o gate do Health Connect só existe no Android compilado.
  const naPulseira = Platform.OS === 'android' && isFeatureEnabled('healthConnect');
  const aparelho: PhoneKind = naPulseira ? 'ANDROID_PHONE' : 'IPHONE';
  const copy = pairingCopy(aparelho);

  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);
  // O pareamento concluído nesta tela vale antes de o envio reler a
  // credencial (o chaveiro no iPhone, o SecureStore no Android).
  const [concluido, setConcluido] = useState(false);
  const pareado = concluido || envio.paired;

  const aoDigitar = (texto: string) => {
    setCodigo(texto.replace(/\D/g, '').slice(0, CODE_LENGTH));
    setRecusa(null);
  };

  const parear = async () => {
    setEnviando(true);
    setRecusa(null);
    // No iPhone, os padrões do serviço (o controle do relógio); no Android, o
    // controle do SecureStore e o tipo de aparelho que o backend registra.
    const resultado = naPulseira
      ? await completeEnrollment(codigo, {
          control: androidDeviceControl,
          deviceKind: 'ANDROID_PHONE',
        })
      : await completeEnrollment(codigo);
    if (resultado.paired && naPulseira) {
      // Cada pareamento cria outro aparelho no servidor, que recusa as
      // sessões do anterior: o leitor do Health Connect troca o sal antes de
      // o envio reler a credencial e de a primeira sincronização sair. A
      // falha só avisa: o pareamento já deu certo e continua valendo.
      try {
        await envio.resetHealthConnectForNewPairing();
      } catch (error) {
        console.warn(
          `[WatchPairing] reset do Health Connect no pareamento novo falhou: ${String(
            (error as { message?: unknown })?.message ?? error,
          )}`,
        );
      }
    }
    setEnviando(false);
    if (resultado.paired) {
      setConcluido(true);
      // O envio da raiz relê a credencial e começa sem remontar nada.
      envio.refreshPairing();
      return;
    }
    setRecusa(pairingFailureCopy(resultado.reason, aparelho));
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
          <>
            <View style={{ gap: theme.gap.s }}>
              <Title variant="title.s" color={theme.content.dark}>
                {copy.pareadoTitulo}
              </Title>
              <Text variant="body.m" color={theme.content.dark}>
                {copy.pareadoCorpo}
              </Text>
            </View>
            {naPulseira && <HealthConnectPairingStep />}
          </>
        ) : (
          <>
            <View style={{ gap: theme.gap.s }}>
              <Title variant="title.s" color={theme.content.dark}>
                {copy.titulo}
              </Title>
              <Text variant="body.m" color={theme.content.dark}>
                {copy.instrucao}
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
