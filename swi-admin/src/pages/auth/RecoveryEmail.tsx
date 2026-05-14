// src/pages/auth/RecoveryEmail.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Input, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { authApi } from '@/services/mockApi/auth'
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

  return (
    <View
      style={{
        flex: 1,
        minHeight: '100vh' as unknown as number,
        backgroundColor: theme.background,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.xl,
      }}
    >
      <View
        testID={phase === 'form' ? 'recovery-email-page' : 'recovery-email-sent'}
        style={{ width: 328, gap: theme.gap.l }}
      >
        {phase === 'form' ? (
          <>
            <Title variant="title.xs" color={theme.content.dark}>
              Vamos recuperar a sua senha
            </Title>
            <Text variant="body.m" color={theme.content.dark}>
              Insira seu endereço de email, vamos enviar um link de recuperação para você
            </Text>
            <Input
              label="e-mail"
              accessibilityLabel="e-mail"
              placeholder="seu@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <FormError message={error} />
            <Button
              label="Enviar Link"
              variant="contained"
              fullWidth
              onPress={onSubmit}
              disabled={loading}
              accessibilityLabel="Enviar Link"
            />
          </>
        ) : (
          <>
            <Title variant="title.xs" color={theme.content.dark}>
              E-mail enviado
            </Title>
            <Text variant="body.m" color={theme.content.dark}>
              Se o e-mail existir, enviamos as instruções para redefinir sua senha. Verifique sua
              caixa de entrada.
            </Text>
            <Text variant="body.m" color={theme.content.dark}>
              <Link to="/login">Voltar para o login</Link>
            </Text>
          </>
        )}
      </View>
    </View>
  )
}
