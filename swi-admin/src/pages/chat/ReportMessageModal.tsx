// src/pages/chat/ReportMessageModal.tsx
// Form de denúncia da mensagem do chat (mensagem de outra pessoa). Segue o
// molde do SupportModal: scrim absoluto pressável, card centralizado, Combobox
// de motivo + texto opcional, estados idle/sending/sent com sucesso in-place.
// Mora na PÁGINA (não na bolha): dentro da ChatBubble o modal seria recortado
// pelo overflowX hidden do quadro de mensagens.
//
// O envio vai pro endpoint de denúncia do chat, que dispara o e-mail no
// backend (REPORT_TO_EMAIL). Não altera estado do chat, então não passa pelo
// ChatProvider: chama a chatsApi direto, como o SupportModal faz com a
// supportApi.
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Button, Combobox, Icon, Input, Text, Title, useTheme } from '@kavicki/swi-design-system'
import type { ChatMessage } from '@/services/chats'
import { chatsApi } from '@/services/api/chats'
import { FormError } from '@/components/FormError'

export const REPORT_MOTIVO_OPTIONS = [
  { label: 'Assédio ou intimidação', value: 'harassment' },
  { label: 'Discurso de ódio', value: 'hate' },
  { label: 'Conteúdo impróprio', value: 'inappropriate' },
  { label: 'Spam', value: 'spam' },
  { label: 'Outros', value: 'other' },
]

// A "caixa de ~240 caracteres" da planilha. O DS 0.1.132 corta no maxLength e
// expõe o contador, senão o corte seria uma parede muda.
export const REPORT_TEXT_MAX = 240

export function ReportMessageModal({
  conversationId,
  message,
  onClose,
}: {
  conversationId: string
  message: ChatMessage
  onClose: () => void
}) {
  const theme = useTheme()
  const [motivo, setMotivo] = useState('')
  const [detalhe, setDetalhe] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!motivo) {
      setError('Selecione o motivo da denúncia.')
      return
    }
    setError(null)
    setStatus('sending')
    // Manda o LABEL do motivo (legível pra quem recebe o e-mail), não o slug.
    const reason = REPORT_MOTIVO_OPTIONS.find((o) => o.value === motivo)?.label ?? motivo
    const text = detalhe.trim()
    const { error: err } = await chatsApi.reportMessage(
      conversationId,
      message.id,
      text ? { reason, text } : { reason },
    )
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
              Denunciar mensagem
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
          <View testID="report-sent" style={{ gap: theme.gap.l, alignItems: 'center' }}>
            {/* Hierarquia herdada do SupportModal (corpo recua,
                Fechar desce pra outline), com uma diferença: aqui o título da
                confirmação sai em branco e um degrau abaixo, não no verde do
                cabeçalho. Dois títulos verdes empilhados no mesmo card
                disputam a atenção; quem separa os dois é a cor. */}
            <View style={{ gap: theme.gap.s, alignItems: 'center' }}>
              <Title variant="title.xs" color={theme.content.dark}>
                Denúncia enviada
              </Title>
              <Text variant="body.m" color={theme.content.medium}>
                Recebemos a sua denúncia. Ela será analisada pela equipe responsável.
              </Text>
            </View>
            <Button label="Fechar" variant="outline" onPress={onClose} />
          </View>
        ) : (
          <>
            <Combobox
              label="Motivo da denúncia"
              placeholder="Selecione aqui"
              options={REPORT_MOTIVO_OPTIONS}
              value={motivo}
              onChange={setMotivo}
            />
            <Input
              label="Detalhes (opcional)"
              placeholder="Descreva o que aconteceu"
              value={detalhe}
              onChangeText={setDetalhe}
              multiline
              numberOfLines={4}
              maxLength={REPORT_TEXT_MAX}
              counter
            />
            <FormError message={error} />
            <Button
              label={status === 'sending' ? 'Enviando…' : 'Enviar denúncia'}
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
