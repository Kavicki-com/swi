import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Text, Title, useTheme } from '@kavicki/swi-design-system';

// Placeholder shown when a feature is gated by `featureFlags.IS_PROD_BUILD`.
// Renders a centered icon + title + body + back link in place of the gated
// screen, so the demo build never crashes when the user reaches a route
// whose underlying feature (BLE, native maps, push) only works in a real
// prod build.

export interface ProdOnlyPlaceholderProps {
  title?: string;
  body?: string;
}

export function ProdOnlyPlaceholder({
  title = 'Disponível na versão final',
  body = 'Esta funcionalidade depende de recursos nativos e estará disponível na build de produção.',
}: ProdOnlyPlaceholderProps) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(app)/dashboard');
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + theme.gap.l,
        paddingBottom: insets.bottom + theme.gap.l,
        paddingHorizontal: theme.padding.m,
      }}
    >
      <Pressable
        onPress={handleBack}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hitSlop={12}
        style={{ alignSelf: 'flex-start', padding: theme.gap.xs }}
      >
        <Icon name="close" size={24} color={theme.content.dark} />
      </Pressable>

      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.gap.m,
        }}
      >
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: theme.surface.medium,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="build" size={36} color={theme.content.dark} />
        </View>

        <Title variant="title.s" color={theme.content.dark} style={{ textAlign: 'center' }}>
          {title}
        </Title>

        <Text
          variant="body.m"
          color={theme.content.medium}
          style={{ textAlign: 'center', maxWidth: 320 }}
        >
          {body}
        </Text>
      </View>
    </View>
  );
}
