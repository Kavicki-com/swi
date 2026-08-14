import { useEffect } from 'react';
import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessBadge, Text, Title, useTheme } from '@kavicki/swi-design-system';

// tela inicial". 2.5s gives the user time to register the success state and
// matches the "feels intentional, not too snappy" rhythm of similar flows.
const REDIRECT_MS = 2500;

export default function AccountConfirmation() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const t = setTimeout(() => {
      // está na fila de aprovação do painel. Ninguém está autenticado aqui —
      // o worker volta pro login e, quando o admin aprovar, o primeiro login
      // o desvia pro wizard de perfil (complimentary-data).
      router.replace('/(auth)/login');
    }, REDIRECT_MS);
    return () => clearTimeout(t);
    // `router` from useRouter() is referentially stable across renders;
    // including it in deps re-runs this fire-and-go timer for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../assets/login-bg.png')}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        style={{
          flex: 1,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingHorizontal: theme.padding.m,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: '100%', gap: theme.gap.l, alignItems: 'center' }}>
          <SuccessBadge
            iconName="check_circle"
            iconColor={theme.content.light}
            accessibilityLabel="Conta criada com sucesso"
          />
          <Title variant="title.xs">Conta criada com sucesso!</Title>
          <Text variant="body.s" style={{ textAlign: 'center', color: theme.content.medium }}>
            Seu cadastro foi enviado para aprovação do administrador. Você
            poderá entrar assim que ele for aprovado.
          </Text>
        </View>
      </View>
    </View>
  );
}
