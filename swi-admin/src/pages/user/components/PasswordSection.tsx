// src/pages/user/components/PasswordSection.tsx
// Coluna "Senha de acesso". Extraída de UserSettings.tsx.
//
// As três visibilidades (o olho de cada campo) viraram estado DESTE
// componente: nunca foram lidas fora dos próprios olhos, e a seção é
// renderizada incondicionalmente, então o estado tem exatamente o mesmo ciclo
// de vida que tinha na página. Os três valores continuam vindo por prop
// porque changePassword os limpa depois do sucesso.
import { useState } from 'react'
import { View } from 'react-native'
import { Button, Title, useTheme } from '@kavicki/swi-design-system'
import { FormError } from '@/components/FormError'
import { PasswordInput } from './PasswordInput'

export function PasswordSection({
  currentPw,
  onCurrentPwChange,
  newPw,
  onNewPwChange,
  confirmPw,
  onConfirmPwChange,
  pwError,
  changingPw,
  onChangePassword,
}: {
  currentPw: string
  onCurrentPwChange: (value: string) => void
  newPw: string
  onNewPwChange: (value: string) => void
  confirmPw: string
  onConfirmPwChange: (value: string) => void
  pwError: string | null
  changingPw: boolean
  onChangePassword: () => void
}) {
  const theme = useTheme()
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  return (
    // NOTE: DS Input's iconRight overflows the text-area horizontally
    // when the input is narrow (≤245px), flex:1 on the inner
    // TextInput pushes the iconRight out by ~32px.  Workaround:
    // pass `secureTextEntry` to the Input *without* iconRight, then
    // overlay the visibility Pressable absolutely so it stays inside
    // the input box no matter how narrow the column is. Bump DS
    // later to clip iconRight properly.
    <View style={{ flex: 1, gap: theme.gap.s }}>
      <Title variant="title.xs" color={theme.content.primary}>
        Senha de acesso
      </Title>
      <PasswordInput
        label="Senha atual"
        value={currentPw}
        onChangeText={onCurrentPwChange}
        visible={showCurrent}
        onToggleVisible={() => setShowCurrent((v) => !v)}
        testID="settings-current-pw"
      />
      <PasswordInput
        label="Nova senha"
        value={newPw}
        onChangeText={onNewPwChange}
        visible={showNew}
        onToggleVisible={() => setShowNew((v) => !v)}
        testID="settings-new-pw"
      />
      <PasswordInput
        label="Repetir nova senha"
        value={confirmPw}
        onChangeText={onConfirmPwChange}
        visible={showConfirm}
        onToggleVisible={() => setShowConfirm((v) => !v)}
        testID="settings-confirm-pw"
      />
      <FormError message={pwError} />
      <Button
        label={changingPw ? 'Alterando…' : 'Alterar senha'}
        variant="contained"
        backgroundColor={theme.surface.secondary}
        size="small"
        disabled={changingPw}
        onPress={onChangePassword}
      />
    </View>
  )
}
