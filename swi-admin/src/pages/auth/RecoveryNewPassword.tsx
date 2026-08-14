// src/pages/auth/RecoveryNewPassword.tsx
//
// Password recovery: step 2 (set new password).
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { View } from 'react-native'
import { Button, Input, Text, Title, Toast, useTheme } from '@kavicki/swi-design-system'
import { authApi } from '@/services/auth'
import { matches, minLength } from '@/lib/validators'
import { FormError } from '@/components/FormError'
import { VisibilityToggle } from '@/components/VisibilityToggle'

type Phase = 'form' | 'sent'

export function RecoveryNewPassword() {
  const theme = useTheme()
  const [searchParams] = useSearchParams()
  // O link do e-mail carrega email + código (o backend é code-based; a URL só
  // embute o código pra virar um link clicável). Sem token — ver services/api/auth.
  const email = searchParams.get('email') ?? ''
  const code = searchParams.get('code') ?? ''
  const [phase, setPhase] = useState<Phase>('form')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword

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
    // Sem email/código o link é inválido/adulterado — o backend rejeitaria com
    // 400, mas barrar aqui dá mensagem clara em vez de "Código inválido".
    if (!email || !code) {
      setError('Link inválido ou expirado. Solicite a recuperação novamente.')
      return
    }
    setLoading(true)
    const result = await authApi.resetPassword({ email, code, newPassword })
    setLoading(false)
    if (result.error) {
      setError(result.error.message ?? 'Falha ao redefinir senha')
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
        testID={phase === 'form' ? 'recovery-newpassword-page' : 'recovery-newpassword-sent'}
        style={{ width: 328, gap: theme.gap.l }}
      >
        {phase === 'form' ? (
          <>
            <Title variant="title.xs" color={theme.content.dark}>
              Crie a sua nova senha
            </Title>
            <Text variant="body.m" color={theme.content.dark}>
              Escolha uma senha segura para o seu acesso, ela deve seguir os padrões abaixo:
            </Text>
            {/* A regra anunciada tem que ser a regra APLICADA: o backend valida
                @MinLength(6) em signup/reset/troca (swi-backend/src/auth/dto.ts)
                e não exige letra+número nem símbolo. Anunciar aqui uma regra
                mais forte que a do servidor promete uma proteção que não
                existe. Se o produto quiser a regra forte, ela sobe no DTO
                primeiro, e só então esta copy cresce junto. */}
            <Toast
              variant="info"
              title="Sua senha precisa ter no mínimo 6 caracteres"
              message="Use uma combinação difícil de adivinhar — evite datas e sequências."
            />
            <Input
              label="Nova Senha"
              accessibilityLabel="Nova senha"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry={!showNew}
              iconRight={<VisibilityToggle on={showNew} onToggle={() => setShowNew((v) => !v)} />}
            />
            <View style={{ gap: theme.gap.xs }}>
              <Input
                label="Confirmar nova senha"
                accessibilityLabel="Confirmar senha"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirm}
                iconRight={
                  <VisibilityToggle on={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />
                }
              />
              {passwordsMatch && (
                <Text variant="body.s" color={theme.content.success} testID="passwords-match">
                  As senhas são iguais ✓
                </Text>
              )}
            </View>
            <FormError message={error} />
            <Button
              label="Alterar senha"
              variant="contained"
              fullWidth
              onPress={onSubmit}
              disabled={loading}
              accessibilityLabel="Alterar senha"
            />
          </>
        ) : (
          <>
            <Title variant="title.xs" color={theme.content.dark}>
              Senha alterada
            </Title>
            <Text variant="body.m" color={theme.content.dark}>
              Sua senha foi atualizada. Use a nova senha para entrar.
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
