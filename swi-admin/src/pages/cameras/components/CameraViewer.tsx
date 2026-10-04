// Visualização da câmera selecionada. O SWI não transmite vídeo: mostra a
// página da câmera no sistema do cliente, dentro do painel quando o endereço
// é https, e sempre oferece abrir em nova aba, porque o fornecedor pode
// proibir que a página seja embutida em outro site (o quadro fica em branco e
// o painel não tem como saber).
import { View } from 'react-native'
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system'
import type { Camera } from '@/services/api/cameras'
import { cameraViewOf } from '../cameraView'

// O quadro roda a página da câmera isolada: sem acesso à sessão do painel
// (origens do painel e da API nem chegam aqui, ver cameraView) e sem poder
// navegar a aba do administrador. Formulário e janelas ficam liberados porque
// a página de câmera costuma pedir login antes da imagem.
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-presentation'

const openInNewTab = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

export function CameraViewer({ camera }: { camera: Camera | null }) {
  const theme = useTheme()

  if (!camera) {
    return (
      <View testID="camera-viewer" style={{ gap: theme.gap.s }}>
        <Text variant="body.m" color={theme.content.medium}>
          Selecione uma câmera da lista para ver a imagem.
        </Text>
      </View>
    )
  }

  const view = cameraViewOf(camera.url)

  return (
    <View testID="camera-viewer" style={{ gap: theme.gap.s }}>
      <Title variant="title.s" color={theme.content.primary}>
        {camera.name}
      </Title>
      {view.kind === 'embed' ? (
        <>
          <View
            style={{
              aspectRatio: 16 / 9,
              borderRadius: theme.border.radius.m,
              overflow: 'hidden',
              backgroundColor: theme.surface.medium,
            }}
          >
            <iframe
              title={`Câmera ${camera.name}`}
              src={view.url}
              sandbox={SANDBOX}
              allow="autoplay; fullscreen"
              style={{ width: '100%', height: '100%', border: 0 }}
            />
          </View>
          <Text variant="body.s" color={theme.content.dark}>
            Se a imagem não aparecer, o sistema da câmera não permite abrir dentro do painel. Use
            &quot;Abrir em nova aba&quot;.
          </Text>
        </>
      ) : view.kind === 'link' ? (
        <Text variant="body.m" color={theme.content.medium}>
          {view.reason === 'http'
            ? 'Este endereço só abre em nova aba: o navegador não mostra endereço http dentro do painel.'
            : 'Este endereço só abre em nova aba: é uma página do próprio SWI, que não é mostrada dentro do painel.'}
        </Text>
      ) : (
        <Text variant="body.m" color={theme.content.medium}>
          Sem endereço cadastrado para esta câmera. Edite a câmera para informar a página dela.
        </Text>
      )}
      {view.kind === 'none' ? null : (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button
            label="Abrir em nova aba"
            variant="outline"
            onPress={() => openInNewTab(view.url)}
          />
        </View>
      )}
    </View>
  )
}
