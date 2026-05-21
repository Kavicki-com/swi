// src/components/SupportModal.tsx
// Support form modal — Figma 105:11612. Floats over the current page with
// a dark scrim. Consumers:
//   - /user/settings → "Solicitar suporte" CTA
//   - /login → "Suporte" button
//
// Scrim is absolute-positioned and pressable — clicking outside the form
// closes the modal. Z-index 100 puts it above all in-page content.
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Button, Combobox, Icon, Input, Title, useTheme } from '@kavicki/swi-design-system'

export const SUPPORT_MOTIVO_OPTIONS = [
  { label: 'Problema técnico', value: 'tech' },
  { label: 'Dúvida sobre uso', value: 'usage' },
  { label: 'Sugestão de melhoria', value: 'suggestion' },
  { label: 'Reportar bug', value: 'bug' },
  { label: 'Outros', value: 'other' },
]

export function SupportModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  const [motivo, setMotivo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [mensagem, setMensagem] = useState('')
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fechar modal"
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        style={{
          width: 596,
          backgroundColor: theme.background,
          borderRadius: theme.border.radius.l,
          padding: theme.padding.m,
          gap: theme.gap.m,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m }}>
          <View style={{ flex: 1 }}>
            <Title variant="title.xs" color={theme.content.primary}>
              Solicitação de suporte
            </Title>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={onClose}
            style={{ padding: 4 }}
          >
            <Icon name="close" size={20} color={theme.content.dark} />
          </Pressable>
        </View>
        <Combobox
          label="Motivo da solicitação"
          placeholder="Selecione aqui"
          options={SUPPORT_MOTIVO_OPTIONS}
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
          numberOfLines={6}
        />
        <Button
          label="Enviar solicitação"
          variant="contained"
          backgroundColor={theme.surface.primary}
          fullWidth
          onPress={onClose}
        />
      </View>
    </View>
  )
}
