// Vídeo ao vivo do funcionário escolhido. O DS não tem player: o vídeo é o
// elemento do próprio navegador, dentro de uma View com os tokens do DS (como
// o quadro da câmera fixa). Sem som: a transmissão é só de imagem.
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system'
import type { LiveViewState } from '@/services/live/liveViewer'

function statusText(view: LiveViewState, name: string): string | null {
  switch (view.status) {
    case 'connecting':
      return `Conectando à câmera de ${name}…`
    case 'ended':
      return `${name} desligou a câmera.`
    case 'full':
      return 'Esta transmissão já tem 3 administradores assistindo. Tente de novo mais tarde.'
    case 'failed':
      return 'Não foi possível receber a imagem. A rede do celular ou do painel pode estar bloqueando a conexão direta.'
    default:
      return null
  }
}

export function LiveViewer({
  name,
  view,
  onStop,
  onRetry,
}: {
  /** Nome de quem foi escolhido; null quando não há escolha que a tela conheça. */
  name: string | null
  view: LiveViewState
  onStop: () => void
  onRetry: () => void
}) {
  const theme = useTheme()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playing = view.status === 'playing' && view.stream !== null

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = playing ? view.stream : null
  }, [playing, view.stream])

  if (name === null || view.status === 'idle') {
    return (
      <View testID="live-viewer" style={{ gap: theme.gap.s }}>
        <Text variant="body.m" color={theme.content.medium}>
          Selecione um funcionário da lista para assistir.
        </Text>
      </View>
    )
  }

  const text = statusText(view, name)
  const watching = view.status === 'connecting' || view.status === 'playing'
  const canRetry = view.status === 'failed' || view.status === 'full'

  return (
    <View testID="live-viewer" style={{ gap: theme.gap.s }}>
      <Title variant="title.s" color={theme.content.primary}>
        {name}
      </Title>
      <View
        style={{
          aspectRatio: 16 / 9,
          borderRadius: theme.border.radius.m,
          overflow: 'hidden',
          backgroundColor: theme.surface.medium,
          alignItems: 'center',
          justifyContent: 'center',
          padding: playing ? 0 : theme.padding.m,
        }}
      >
        {playing ? (
          <video
            ref={videoRef}
            aria-label={`Câmera ao vivo de ${name}`}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <Text variant="body.m" color={theme.content.dark} accessibilityLiveRegion="polite">
            {text}
          </Text>
        )}
      </View>
      {watching ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button label="Parar de assistir" variant="outline" onPress={onStop} />
        </View>
      ) : null}
      {canRetry ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button label="Tentar novamente" variant="outline" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  )
}
