// src/pages/auth/Login.tsx
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Checkbox, Input, Logo, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { isEmail, requiredText } from '@/lib/validators'
import { FormError } from '@/components/FormError'

type LocationState = { from?: string } | null

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
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
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.xl,
        gap: theme.gap.m,
      }}
    >
      <Logo />
      <Title>Entrar no SWI</Title>
      <Input
        label="E-mail"
        accessibilityLabel="E-mail"
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
        secureTextEntry
      />
      <Checkbox checked={remember} onChange={setRemember} label="Lembrar de mim" />
      <FormError message={error} />
      <Button
        label="Entrar"
        onPress={onSubmit}
        disabled={loading}
        accessibilityLabel="Entrar"
      />
      <Text>
        <Link to="/recovery/email">Esqueci minha senha</Link>
      </Text>
      <Text>
        Novo aqui? <Link to="/sign-up">Criar conta</Link>
      </Text>
    </View>
  )
}
