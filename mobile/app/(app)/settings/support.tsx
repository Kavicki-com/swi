import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Combobox,
  Icon,
  Input,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 348:10426 — bottom-sheet modal "Solicitação de suporte".
// Aberto como `presentation: 'transparentModal'` pra render como
// overlay sobre o settings hub. Backdrop pressable dispara router.back.
// Demo phase: useState efêmero, Enviar → router.back sem persistência.
export default function SettingsSupport() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [motivo, setMotivo] = useState('');
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');

  const close = () => router.back();

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'transparentModal',
          animation: 'slide_from_bottom',
        }}
      />

      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        {/* Backdrop — clicar fecha modal */}
        <Pressable
          onPress={close}
          accessibilityLabel="Fechar"
          accessibilityRole="button"
          style={{ flex: 1 }}
        />

        {/* Modal content — bottom sheet style, top-rounded */}
        <View
          style={{
            backgroundColor: theme.background,
            paddingTop: theme.padding.m,
            paddingHorizontal: theme.padding.m,
            paddingBottom: insets.bottom + theme.padding.xl,
            borderTopLeftRadius: theme.border.radius.l,
            borderTopRightRadius: theme.border.radius.l,
            gap: theme.gap.m,
          }}
        >
          {/* Header: title + close icon */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m }}>
            <View style={{ flex: 1 }}>
              <Title variant="title.xs" color={theme.content.primary}>
                Solicitação de suporte
              </Title>
            </View>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Fechar"
            >
              <Icon name="close" size={24} color={theme.content.dark} />
            </Pressable>
          </View>

          <Combobox
            label="Motivo da solicitação"
            placeholder="Selecione aqui"
            options={[]}
            value={motivo}
            onChange={setMotivo}
          />

          <Input
            label="Título da sua solicitação"
            placeholder="Digite aqui"
            value={titulo}
            onChangeText={setTitulo}
          />

          <Input
            label="Mensagem"
            placeholder="Digite aqui a sua mensagem"
            value={mensagem}
            onChangeText={setMensagem}
            multiline
            numberOfLines={5}
          />

          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Enviar solicitação"
            elevation="lg"
            accessibilityLabel="Enviar solicitação"
            onPress={close}
          />
        </View>
      </View>
    </>
  );
}
