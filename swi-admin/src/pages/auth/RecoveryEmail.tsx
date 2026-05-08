// src/pages/auth/RecoveryEmail.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Input, Logo, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { authApi } from '@/services/mockApi'
import { isEmail } from '@/lib/validators'
import { FormError } from '@/components/FormError'

type Phase = 'form' | 'sent'

export function RecoveryEmail() {
  const theme = useTheme()
  const [phase, setPhase] = useState<Phase>('form')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async () => {
    setError(null)
    if (!isEmail(email)) {
      setError('Informe um e-mail válido')
      return
    }
    setLoading(true)
    const result = await authApi.requestPasswordReset({ email })
    setLoading(false)
    if (result.error) {
      setError(result.error.message ?? 'Falha ao enviar instruções')
      return
    }
    setPhase('sent')
  }

  if (phase === 'sent') {
    return (
      <View
        testID="recovery-email-sent"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.padding.xl,
          gap: theme.gap.m,
        }}
      >
        <Logo />
        <Title>E-mail enviado</Title>
        <Text>
          Se o e-mail existir, enviamos as instruções para redefinir sua senha. Verifique sua caixa
          de entrada.
        </Text>
        <Text>
          <Link to="/login">Voltar para o login</Link>
        </Text>
      </View>
    )
  }

  return (
    <View
      testID="recovery-email-page"
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.xl,
        gap: theme.gap.m,
      }}
    >
      <Logo />
      <Title>Recuperar senha</Title>
      <Text>Informe o e-mail cadastrado e enviaremos as instruções para redefinir sua senha.</Text>
      <Input
        label="E-mail"
        accessibilityLabel="E-mail"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <FormError message={error} />
      <Button
        label="Enviar instruções"
        onPress={onSubmit}
        disabled={loading}
        accessibilityLabel="Enviar instruções"
      />
      <Text>
        <Link to="/login">Voltar para o login</Link>
      </Text>
    </View>
  )
}
