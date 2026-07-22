// src/pages/_shared/ConfirmDialog.tsx
// Diálogo de confirmação compartilhado — composição page-level (Pressable scrim +
// card + Title + Text + Button do DS). Extraído do ConfirmReject que vivia inline
// no EmployeesList; agora a fila de aprovação e a exclusão de admin reusam a mesma
// peça. Não reimplementa primitiva do DS: só orquestra Pressable/Title/Text/Button
// e consome tokens via useTheme. Ações destrutivas passam `confirmDanger` pra
// tingir o CTA de confirmação com surface.error.
import { useEffect } from 'react'
import { Pressable, View } from 'react-native'
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system'

type ConfirmDialogProps = {
  title: string
  message: string
  confirmLabel: string
  confirmDanger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmDanger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const theme = useTheme()
  // Escape fecha o diálogo (semântica de modal). Listener no window enquanto
  // o overlay está montado; removido no cleanup.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])
  return (
    <Pressable
      accessibilityLabel="Fechar"
      onPress={onCancel}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.m,
        zIndex: 1000,
      }}
    >
      {/* Card por cima do scrim: clique dentro dele é capturado aqui e NÃO
          propaga pro scrim (que fecharia). accessibilityViewIsModal marca o
          card como modal (aria-modal no react-native-web). */}
      <Pressable
        accessibilityViewIsModal
        onPress={() => {}}
        style={{
          backgroundColor: theme.surface.standard,
          borderRadius: theme.border.radius.m,
          padding: theme.padding.l,
          gap: theme.gap.m,
          maxWidth: 420,
          width: '100%',
        }}
      >
        <Title variant="title.xs" color={theme.content.dark}>
          {title}
        </Title>
        <Text variant="body.m" color={theme.content.dark}>
          {message}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: theme.gap.s,
          }}
        >
          <Button
            label="Cancelar"
            variant="outline"
            accessibilityLabel="Cancelar"
            onPress={onCancel}
          />
          <Button
            label={confirmLabel}
            variant="contained"
            backgroundColor={confirmDanger ? theme.surface.error : undefined}
            accessibilityLabel={confirmLabel}
            onPress={onConfirm}
          />
        </View>
      </Pressable>
    </Pressable>
  )
}
