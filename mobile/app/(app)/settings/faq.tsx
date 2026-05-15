import { useState } from 'react';
import { Image as RNImage, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Accordion,
  Button,
  Icon,
  SearchInput,
  Title,
  TopBar,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 361:12425 — settings sub-screen FAQ. Hero title + SearchInput +
// 12 Accordions (todas collapsed por default) + Pagination + Home FAB.
// Demo phase: search e pagination não filtram nada.
const FAQS = [
  'Como faço para criar uma conta?',
  'Esqueci minha senha, o que fazer?',
  'Posso usar o aplicativo offline?',
  'Como atualizar meu perfil?',
  'O aplicativo é gratuito?',
  'Como faço para cancelar minha assinatura?',
  'O que fazer se o aplicativo travar?',
  'Como ativar notificações?',
  'Posso sincronizar meus dados entre dispositivos?',
  'Como envio feedback ou reporto um problema?',
  'O aplicativo suporta múltiplos idiomas?',
  'Como proteger minha conta?',
];

export default function SettingsFAQ() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/settings-faq-bg.png')}
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
          alignItems: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        <TopBar title="FAQ" onBack={() => router.back()} />

        <View
          style={{
            width: 328,
            marginTop: theme.padding.sm,
            alignItems: 'stretch',
            gap: 38,
          }}
        >
          {/* Hero title — Figma 361:12703 Montserrat Bold 16 content.dark */}
          <Title variant="title.xs" color={theme.content.dark}>
            Tire suas dúvidas com a nossa central de perguntas frequentes
          </Title>

          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder="Pesquisar"
          />

          <View style={{ gap: theme.gap.sm }}>
            {FAQS.map((q) => (
              <Accordion
                key={q}
                title={q}
                fullWidth
                showIconLeft={false}
              />
            ))}

            {/* Pagination — Figma 361:12705. 4 outline (1-4) + ghost (…) +
                contained chevron-right. Demo phase: estado controla qual
                página está "ativa" só visualmente. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              {[1, 2, 3, 4].map((n) => (
                <View key={n} style={{ flex: 1 }}>
                  <Button
                    variant="ghost"
                    label={String(n)}
                    accessibilityLabel={`Página ${n}`}
                    onPress={() => setCurrentPage(n)}
                  />
                </View>
              ))}
              <View style={{ flex: 1 }}>
                <Button
                  variant="ghost"
                  label="..."
                  accessibilityLabel="Mais páginas"
                  onPress={() => {}}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  variant="contained"
                  backgroundColor={theme.surface.primary}
                  accessibilityLabel="Próxima página"
                  onPress={() => setCurrentPage((p) => p + 1)}
                  iconLeft={
                    <Icon
                      name="keyboard_arrow_right"
                      width={7.4}
                      height={12}
                      color={theme.content.light}
                    />
                  }
                />
              </View>
            </View>
          </View>
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
        <Button
          variant="contained"
          shape="pill"
          size="xlarge"
          backgroundColor={theme.content.dark}
          borderColor={theme.content.disable}
          borderWidth={10}
          elevation="lg"
          iconLeft={
            <Icon
              name="home"
              width={28.286}
              height={25.458}
              color={theme.surface.standard}
            />
          }
          accessibilityLabel="Voltar para a dashboard"
          onPress={() => router.push('/(app)/dashboard')}
        />
      </View>
    </View>
  );
}
