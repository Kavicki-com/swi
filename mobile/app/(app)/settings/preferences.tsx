import { useCallback, useEffect, useState } from 'react';
import { AppState, Image as RNImage, Linking, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import {
  Text,
  Title,
  Toggle,
  TopBar,
  useTheme,
} from '@kavicki/swi-design-system';
import { HomeFAB } from '../../../components/HomeFAB';

// Figma 357:12302 — settings sub-screen "Preferências". 4 toggle rows
// (Notificações / Localização / Acessar pastas e arquivos / Ligações
// telefônicas) sob section title "Permissões" + Home FAB.
//
// Localização e Arquivos espelham a permissão REAL do SO: ligar pede a
// permissão; desligar abre os Ajustes (revogar programaticamente não
// existe em iOS/Android), e o estado é relido quando o app volta ao
// foreground. Notificações e Ligações seguem visuais: notificação exige
// expo-notifications (fora do build atual) e ligação não tem API JS.
export default function SettingsPreferences() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [notifications, setNotifications] = useState(true);
  const [location, setLocation] = useState(false);
  const [filesAccess, setFilesAccess] = useState(false);
  const [phoneCalls, setPhoneCalls] = useState(true);

  const lerPermissoes = useCallback(async () => {
    const [loc, media] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      ImagePicker.getMediaLibraryPermissionsAsync(),
    ]);
    setLocation(loc.granted);
    setFilesAccess(media.granted);
  }, []);

  useEffect(() => {
    void lerPermissoes();
    // Quem desliga um toggle vai parar nos Ajustes do sistema; na volta o
    // app reativa e o estado real precisa reaparecer sem reabrir a tela.
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void lerPermissoes();
    });
    return () => sub.remove();
  }, [lerPermissoes]);

  const aoAlternarLocalizacao = async (ligar: boolean) => {
    if (!ligar) { void Linking.openSettings(); return; }
    const r = await Location.requestForegroundPermissionsAsync();
    setLocation(r.granted);
  };

  const aoAlternarArquivos = async (ligar: boolean) => {
    if (!ligar) { void Linking.openSettings(); return; }
    const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
    setFilesAccess(r.granted);
  };

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
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: theme.padding.m,
        }}
        showsVerticalScrollIndicator={false}
      >
        <TopBar title="Preferências" onBack={() => router.back()} />

        <View
          style={{
            gap: theme.gap.m,
            marginTop: theme.padding.xxl,
          }}
        >
          <Title variant="title.xs" color={theme.content.primary}>
            Permissões
          </Title>

          {/* Toggle + label composto (Figma 357:12357 etc): label
              sempre content.dark Inter Regular 14, independente do
              state. Toggle DS sem `rightLabel` pra evitar o coloring
              active/medium que vincula label ao estado. */}
          {(
            [
              { key: 'notifications', value: notifications, set: setNotifications, label: 'Notificações' },
              { key: 'location', value: location, set: aoAlternarLocalizacao, label: 'Localização' },
              { key: 'filesAccess', value: filesAccess, set: aoAlternarArquivos, label: 'Acessar pastas e arquivos' },
              { key: 'phoneCalls', value: phoneCalls, set: setPhoneCalls, label: 'Ligações telefônicas' },
            ] as const
          ).map(({ key, value, set, label }) => (
            <View
              key={key}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}
            >
              <Toggle value={value} onChange={set} accessibilityLabel={label} />
              <Text variant="body.m" color={theme.content.dark}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        {/* HomeFAB fiel ao Figma 348:10334 (substitui Button DS antigo). */}
        <HomeFAB onPress={() => router.push('/(app)/dashboard')} />
      </View>
    </View>
  );
}
