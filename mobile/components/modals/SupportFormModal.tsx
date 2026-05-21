import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Combobox,
  Icon,
  Input,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 348:10426 — bottom-sheet "Solicitação de suporte".
// Body compartilhado entre `(app)/settings/support.tsx` (authenticated)
// e `modals/support-form.tsx` (acessível também da tela de login).
// Os wrappers de rota injetam o backdrop transparent + envelope do
// Stack.Screen; este componente cuida só do conteúdo do sheet.

interface SupportFormModalProps {
  onClose: () => void;
}

export function SupportFormModal({ onClose }: SupportFormModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [motivo, setMotivo] = useState('');
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');

  return (
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
          onPress={onClose}
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
        onPress={onClose}
      />
    </View>
  );
}
