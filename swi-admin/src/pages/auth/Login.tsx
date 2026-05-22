// src/pages/auth/Login.tsx
//
// Login screen — Figma frame 22:1585.
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Input, Logo, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { isEmail, requiredText } from '@/lib/validators'
import { FormError } from '@/components/FormError'
import { VisibilityToggle } from '@/components/VisibilityToggle'
import { SupportModal } from '@/components/SupportModal'

type LocationState = { from?: string } | null

// Demo credentials — seeded in mockApi/auth.ts. The "Entrar como demo" button
// + the `?demo=true` query-param auto-trigger both sign in with these so the
// client never has to type or memorise credentials when navigating the
// demonstrative state.
const DEMO_EMAIL = 'admin@swi.test'
const DEMO_PASSWORD = 'demo1234'

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const theme = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showSupport, setShowSupport] = useState(false)
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

  const onDemoLogin = async () => {
    setError(null)
    setLoading(true)
    const result = await signIn(DEMO_EMAIL, DEMO_PASSWORD)
    setLoading(false)
    if (result.ok) {
      navigate(from, { replace: true })
    } else {
      setError(result.message ?? 'Falha ao entrar como demo')
    }
  }

  // Auto-login when arriving with `?demo=true` (e.g. shared client URL).
  // Fires once on mount; if the demo credentials fail for any reason, falls
  // through to the regular form with the error message visible.
  useEffect(() => {
    if (searchParams.get('demo') === 'true') {
      void onDemoLogin()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
            // @ts-expect-error labelFamily exists in local DS source; node_modules pin v0.1.35 hasn't received this prop yet.
            labelFamily="title"
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
          <Button
            label="Entrar como demo"
            variant="ghost"
            fullWidth
            onPress={onDemoLogin}
            disabled={loading}
            accessibilityLabel="Entrar como demo"
          />
        </View>

        <Button
          variant="ghost"
          label="Suporte"
          // @ts-expect-error labelFamily exists in local DS source; node_modules pin v0.1.35 hasn't received this prop yet.
          labelFamily="title"
          fullWidth
          accessibilityLabel="Suporte"
          onPress={() => setShowSupport(true)}
        />
      </View>
      {showSupport ? <SupportModal onClose={() => setShowSupport(false)} /> : null}
    </View>
  )
}
