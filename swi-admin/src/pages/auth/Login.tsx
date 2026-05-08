// src/pages/auth/Login.tsx
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Input, Logo, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { isEmail, requiredText } from '@/lib/validators'
import { FormError } from '@/components/FormError'
import { VisibilityToggle } from '@/components/VisibilityToggle'

type LocationState = { from?: string } | null

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const from = (location.state as LocationState)?.from ?? '/'

  const onSubmit = async () => {
    setError(null)
    if (!isEmail(email)) {
      setError('Informe um e-mail válido')
      return
    }
    if (!requiredText(password)) {
      setError('Informe sua senha')
      return
    }
    setLoading(true)
    const result = await signIn(email, password)
    setLoading(false)
    if (result.ok) {
      navigate(from, { replace: true })
    } else {
      setError(result.message ?? 'Falha ao entrar')
    }
  }

  return (
    <View
      testID="login-page"
      style={{
        flex: 1,
        minHeight: '100vh' as unknown as number,
        backgroundColor: theme.background,
        alignItems: 'center',
        paddingTop: 123,
      }}
    >
      <Logo size="l" />
      <View
        style={{
          width: 328,
          marginTop: 56,
          gap: theme.gap.l,
        }}
      >
        <View style={{ gap: theme.gap.l }}>
          <Input
            label="Login"
            accessibilityLabel="Login"
            placeholder="seu@email.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Input
            label="Senha"
            accessibilityLabel="Senha"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            iconRight={
              <VisibilityToggle on={showPassword} onToggle={() => setShowPassword((v) => !v)} />
            }
          />
        </View>

        <View style={{ alignSelf: 'flex-end' }}>
          <Button
            variant="ghost"
            label="Recuperar senha"
            accessibilityLabel="Recuperar senha"
            onPress={() => navigate('/recovery/email')}
          />
        </View>

        <FormError message={error} />

        <View style={{ gap: theme.gap.sm }}>
          <Button
            label="Entrar"
            variant="contained"
            fullWidth
            onPress={onSubmit}
            disabled={loading}
            accessibilityLabel="Entrar"
          />
          <Button
            variant="outline"
            label="Fazer Cadastro"
            fullWidth
            accessibilityLabel="Fazer Cadastro"
            onPress={() => navigate('/sign-up')}
          />
        </View>

        <Button
          variant="ghost"
          label="Suporte"
          fullWidth
          accessibilityLabel="Suporte"
          onPress={() => navigate('/modals/support')}
        />
      </View>
    </View>
  )
}
