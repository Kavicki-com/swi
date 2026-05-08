// src/pages/auth/SignUp.tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Checkbox, Input, Logo, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { isEmail, matches, minLength, requiredText } from '@/lib/validators'
import { FormError } from '@/components/FormError'

export function SignUp() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const theme = useTheme()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async () => {
    setError(null)
    if (!requiredText(fullName)) {
      setError('Informe seu nome completo')
      return
    }
    if (!isEmail(email)) {
      setError('E-mail inválido')
      return
    }
    if (!minLength(password, 8)) {
      setError('Senha deve ter pelo menos 8 caracteres')
      return
    }
    if (!matches(password, confirmPassword)) {
      setError('As senhas não coincidem')
      return
    }
    if (consent !== true) {
      setError('Você precisa aceitar a política de privacidade')
      return
    }
    setLoading(true)
    const result = await signUp({ email, password, full_name: fullName, consent })
    setLoading(false)
    if (result.ok) {
      navigate('/', { replace: true })
    } else {
      setError(result.message ?? 'Falha ao cadastrar')
    }
  }

  return (
    <View
      testID="signup-page"
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.xl,
        gap: theme.gap.m,
      }}
    >
      <Logo />
      <Title>Criar conta</Title>
      <Input
        label="Nome completo"
        accessibilityLabel="Nome completo"
        value={fullName}
        onChangeText={setFullName}
      />
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
      <Input
        label="Confirmar senha"
        accessibilityLabel="Confirmar senha"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />
      <Checkbox checked={consent} onChange={setConsent} label="Aceito a política de privacidade" />
      <Text>
        <Link to="/modals/privacy">Ler política de privacidade</Link>
      </Text>
      <FormError message={error} />
      <Button
        label="Criar conta"
        onPress={onSubmit}
        disabled={loading}
        accessibilityLabel="Criar conta"
      />
      <Text>
        Já tem conta? <Link to="/login">Entrar</Link>
      </Text>
    </View>
  )
}
