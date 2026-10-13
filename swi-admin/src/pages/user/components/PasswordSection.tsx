// src/pages/user/components/PasswordSection.tsx
// Coluna "Senha de acesso". Extraída de UserSettings.tsx.
//
// Os três campos usam o olho embutido do Input do DS (passwordToggle): cada um
// guarda e alterna a própria visibilidade internamente, então a seção não
// precisa mais de estado nem de um campo de senha local. Os três valores
// continuam vindo por prop porque changePassword os limpa depois do sucesso.
import { View } from 'react-native'
import { Button, Input, Title, useTheme } from '@kavicki/swi-design-system'
import { FormError } from '@/components/FormError'

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
  return (
    <View style={{ flex: 1, gap: theme.gap.s }}>
      <Title variant="title.xs" color={theme.content.primary}>
        Senha de acesso
      </Title>
      <Input
        label="Senha atual"
        value={currentPw}
        onChangeText={onCurrentPwChange}
        passwordToggle
        testID="settings-current-pw"
      />
      <Input
        label="Nova senha"
        value={newPw}
        onChangeText={onNewPwChange}
        passwordToggle
        testID="settings-new-pw"
      />
      <Input
        label="Repetir nova senha"
        value={confirmPw}
        onChangeText={onConfirmPwChange}
        passwordToggle
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
