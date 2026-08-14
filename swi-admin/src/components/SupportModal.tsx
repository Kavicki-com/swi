// src/components/SupportModal.tsx
// Support form modal. Floats over the current page with
// a dark scrim. Consumers:
//   - /user/settings → "Solicitar suporte" CTA
//   - /login → "Suporte" button
//
// Scrim is absolute-positioned and pressable — clicking outside the form
// closes the modal. Z-index 100 puts it above all in-page content.
//
// O submit envia de verdade (POST /support via supportApi) e, com sessão,
// anexa o e-mail dela pro suporte responder. Um onPress={onClose} aqui
// descartaria o form em silêncio.
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Button, Combobox, Icon, Input, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { supportApi } from '@/services/api/support'
import { useAuth } from '@/hooks/useAuth'
import { FormError } from '@/components/FormError'

export const SUPPORT_MOTIVO_OPTIONS = [
  { label: 'Problema técnico', value: 'tech' },
  { label: 'Dúvida sobre uso', value: 'usage' },
  { label: 'Sugestão de melhoria', value: 'suggestion' },
  { label: 'Reportar bug', value: 'bug' },
  { label: 'Outros', value: 'other' },
]

export function SupportModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  const { user } = useAuth()
  const [motivo, setMotivo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!motivo || !titulo.trim() || !mensagem.trim()) {
      setError('Preencha motivo, título e mensagem.')
      return
    }
    setError(null)
    setStatus('sending')
    // Manda o LABEL do motivo (legível pro suporte), não o slug interno.
    const reason = SUPPORT_MOTIVO_OPTIONS.find((o) => o.value === motivo)?.label ?? motivo
    const { error: err } = await supportApi.send({
      reason,
      title: titulo.trim(),
      message: mensagem.trim(),
      ...(user?.email ? { email: user.email } : {}),
    })
    if (err) {
      setStatus('idle')
      setError(err.message)
      return
    }
    setStatus('sent')
  }

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fechar modal"
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        style={{
          width: 596,
          backgroundColor: theme.background,
          borderRadius: theme.border.radius.l,
          padding: theme.padding.m,
          gap: theme.gap.m,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m }}>
          <View style={{ flex: 1 }}>
            <Title variant="title.xs" color={theme.content.primary}>
              Solicitação de suporte
            </Title>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={onClose}
            style={{ padding: 4 }}
          >
            <Icon name="close" size={20} color={theme.content.dark} />
          </Pressable>
        </View>
        {status === 'sent' ? (
          <View testID="support-sent" style={{ gap: theme.gap.l, alignItems: 'center' }}>
            {/* Título e mensagem andam juntos (gap.s) e a ação respira longe
                deles (gap.l): a distância é o que separa o recado do botão. */}
            <View testID="support-sent-copy" style={{ gap: theme.gap.s, alignItems: 'center' }}>
              <Title variant="title.s" color={theme.content.primary}>
                Solicitação enviada
              </Title>
              <Text variant="body.m" color={theme.content.medium}>
                Recebemos a sua solicitação. A equipe de suporte vai retornar
                {user?.email ? (
                  <>
                    {' pelo e-mail '}
                    <Text variant="body.m" weight="bold" color={theme.content.dark}>
                      {user.email}
                    </Text>
                  </>
                ) : (
                  ' em breve'
                )}
                .
              </Text>
            </View>
            {/* Não há nada a confirmar aqui, só dispensar: o Fechar desce pra
                outline e para de competir com o título. */}
            <Button label="Fechar" variant="outline" onPress={onClose} />
          </View>
        ) : (
          <>
            <Combobox
              label="Motivo da solicitação"
              placeholder="Selecione aqui"
              options={SUPPORT_MOTIVO_OPTIONS}
              value={motivo}
              onChange={setMotivo}
            />
            <Input
              label="Título da sua solicitação"
              placeholder="Digite aqui"
              value={titulo}
              onChangeText={setTitulo}
            />
            <Input
              label="Mensagem"
              placeholder="Digite aqui a sua mensagem"
              value={mensagem}
              onChangeText={setMensagem}
              multiline
              numberOfLines={6}
            />
            <FormError message={error} />
            <Button
              label={status === 'sending' ? 'Enviando…' : 'Enviar solicitação'}
              variant="contained"
              backgroundColor={theme.surface.primary}
              fullWidth
              disabled={status === 'sending'}
              onPress={submit}
            />
          </>
        )}
      </View>
    </View>
  )
}
