// src/pages/auth/RecoveryNewPassword.tsx
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Input, Logo, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { authApi } from '@/services/mockApi'
import { matches, minLength } from '@/lib/validators'
import { FormError } from '@/components/FormError'

type Phase = 'form' | 'invalid' | 'sent'

export function RecoveryNewPassword() {
  const theme = useTheme()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [phase, setPhase] = useState<Phase>(token ? 'form' : 'invalid')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async () => {
    setError(null)
    if (!minLength(newPassword, 8)) {
      setError('Senha deve ter pelo menos 8 caracteres')
      return
    }
    if (!matches(newPassword, confirmPassword)) {
      setError('As senhas não coincidem')
      return
    }
    setLoading(true)
    const result = await authApi.resetPassword({ token, newPassword })
    setLoading(false)
    if (result.error) {
      setError(result.error.message ?? 'Falha ao redefinir senha')
      return
    }
    setPhase('sent')
  }

  if (phase === 'invalid') {
    return (
      <View
        testID="recovery-newpassword-invalid"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.padding.xl,
          gap: theme.gap.m,
        }}
      >
        <Logo />
        <Title>Link inválido</Title>
        <Text>
          Este link expirou ou é inválido. Solicite um novo e-mail de recuperação.
        </Text>
        <Text>
          <Link to="/recovery/email">Solicitar novo link</Link>
        </Text>
        <Text>
          <Link to="/login">Voltar para o login</Link>
        </Text>
      </View>
    )
  }

  if (phase === 'sent') {
    return (
      <View
        testID="recovery-newpassword-sent"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.padding.xl,
          gap: theme.gap.m,
        }}
      >
        <Logo />
        <Title>Senha redefinida</Title>
        <Text>Sua senha foi atualizada. Use a nova senha para entrar.</Text>
        <Text>
          <Link to="/login">Voltar para o login</Link>
        </Text>
      </View>
    )
  }

  return (
    <View
      testID="recovery-newpassword-page"
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.xl,
        gap: theme.gap.m,
      }}
    >
      <Logo />
      <Title>Definir nova senha</Title>
      <Text>Escolha uma nova senha para acessar sua conta.</Text>
      <Input
        label="Nova senha"
        accessibilityLabel="Nova senha"
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
      />
      <Input
        label="Confirmar senha"
        accessibilityLabel="Confirmar senha"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />
      <FormError message={error} />
      <Button
        label="Salvar nova senha"
        onPress={onSubmit}
        disabled={loading}
        accessibilityLabel="Salvar nova senha"
      />
      <Text>
        <Link to="/login">Voltar para o login</Link>
      </Text>
    </View>
  )
}
