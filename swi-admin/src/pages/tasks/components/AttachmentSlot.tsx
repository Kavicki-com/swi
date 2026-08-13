// src/pages/tasks/components/AttachmentSlot.tsx
// Extraído de TaskForm.tsx sem mudança de comportamento.
import { View } from 'react-native'
import { Button, Icon, Text, useTheme } from '@kavicki/swi-design-system'

// Quadro vazio da fileira de anexos. `onRemove` (com o
// respectivo label acessível) põe o botão de remoção, mesmo padrão ghost +
// delete_icon dos cards do checklist.
export function AttachmentSlot({
  label,
  onRemove,
  removeLabel,
}: {
  label?: string
  onRemove?: () => void
  removeLabel?: string
}) {
  const theme = useTheme()
  return (
    <View
      style={{
        flex: 1,
        aspectRatio: 5 / 4,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.high,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.s,
        gap: theme.gap.xs,
      }}
    >
      <Icon name="add_a_photo" size={32} color={theme.content.medium} />
      {label ? (
        <Text variant="body.s" color={theme.content.medium} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {onRemove ? (
        <Button
          variant="ghost"
          onPress={onRemove}
          iconLeft={<Icon name="delete_icon" size={20} color={theme.content.error} />}
          accessibilityLabel={removeLabel ?? 'Remover anexo'}
        />
      ) : null}
    </View>
  )
}
