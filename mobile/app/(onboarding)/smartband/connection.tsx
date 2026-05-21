import { Image, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { ProdOnlyPlaceholder } from '../../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../../lib/featureFlags';

export default function SmartbandConnection() {
  if (!isFeatureEnabled('smartbandOnboarding')) {
    return <ProdOnlyPlaceholder />;
  }
  return <SmartbandConnectionScreen />;
}

function SmartbandConnectionScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

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
          paddingTop: insets.top + 26,
          paddingHorizontal: theme.padding.m,
          paddingBottom: theme.gap.l,
          gap: theme.gap.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: theme.gap.s }}>
          <Title variant="title.s" color={theme.content.dark}>
            Vamos configurar a sua
          </Title>
          <Title variant="title.l" color={theme.content.primary}>
            Smartband
          </Title>
          <Text variant="body.m" color={theme.content.dark}>
            Conceda as permissões necessárias no seu telefone para realizar a conexão.
          </Text>
        </View>

        <View style={{ gap: theme.gap.xl, marginTop: theme.gap.l }}>
          <Title variant="title.s" color={theme.content.dark}>
            Para garantir o funcionamento correto da sua Smartband:
          </Title>
          <Text variant="body.m" color={theme.content.dark}>
            1 - Ative o bluetooth no seu dispositivo e garanta que esteja próximo da sua{' '}
            <Text
              variant="body.m"
              color={theme.content.dark}
              style={{ fontWeight: theme.fontWeight.bold }}
            >
              Smartband
            </Text>
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            2 - Conceda permissão de acesso a sua localização em tempo integral com o app
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            3 - Coloque sua smartband no pulso e aguarde a configuração ser concluída
          </Text>
          <Button
            variant="outline"
            label="Conceder permissões"
            fullWidth
            onPress={() => {
              /* demo: no-op. Production triggers Permissions.request() */
            }}
          />
        </View>
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.padding.m,
          paddingBottom: insets.bottom + 16,
          paddingTop: theme.gap.s,
        }}
      >
        <Button
          variant="contained"
          label="Continuar"
          fullWidth
          onPress={() => router.push('/(onboarding)/smartband/connection-start')}
        />
      </View>
    </View>
  );
}
