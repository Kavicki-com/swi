// Aba "Ao vivo": à esquerda quem está transmitindo, à direita o vídeo do
// funcionário escolhido. A escolha mora na URL (?aba=ao-vivo&funcionario=<id>),
// para os botões de câmera do detalhe e do chat abrirem direto no vídeo.
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { Button, Text, useTheme } from '@kavicki/swi-design-system'
import { useLiveRoom } from '../hooks/useLiveRoom'
import { LiveList } from './LiveList'
import { LiveViewer } from './LiveViewer'

export function LiveTab({
  selectedWorkerId,
  onSelect,
}: {
  selectedWorkerId: string | null
  onSelect: (workerId: string | null) => void
}) {
  const theme = useTheme()
  const room = useLiveRoom(selectedWorkerId)
  // Quem já apareceu na lista: quando o funcionário desliga, ele sai da lista
  // no mesmo instante, e o aviso de que desligou ainda precisa do nome.
  const names = useRef(new Map<string, string>())
  for (const b of room.broadcasts) names.current.set(b.workerId, b.name)
  const name = selectedWorkerId ? (names.current.get(selectedWorkerId) ?? null) : null

  // Escolha de alguém que a lista lida não tem (endereço antigo, ou a lista
  // falhou): desfaz, para não ficar uma sessão aberta sem nada na tela.
  const unknown = !room.loading && selectedWorkerId !== null && name === null
  useEffect(() => {
    if (unknown) onSelect(null)
  }, [unknown, onSelect])

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap.l }}>
      <View style={{ flex: 1, gap: theme.gap.s, minWidth: 0 }}>
        {room.loading ? (
          <Text variant="body.m" color={theme.content.medium}>
            Carregando transmissões…
          </Text>
        ) : room.error ? (
          <View style={{ alignItems: 'flex-start', gap: theme.gap.s }}>
            <Text variant="body.m" color={theme.content.error}>
              Não foi possível carregar as transmissões.
            </Text>
            <Button label="Tentar novamente" variant="outline" onPress={room.retryList} />
          </View>
        ) : room.broadcasts.length === 0 ? (
          <Text variant="body.m" color={theme.content.medium}>
            Nenhum funcionário transmitindo agora. A transmissão começa quando o funcionário liga a
            câmera no app.
          </Text>
        ) : (
          <LiveList
            broadcasts={room.broadcasts}
            selectedId={selectedWorkerId}
            onSelect={onSelect}
          />
        )}
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        {room.loading ? null : (
          <LiveViewer
            name={name}
            view={room.view}
            onStop={() => onSelect(null)}
            onRetry={room.retryWatch}
          />
        )}
      </View>
    </View>
  )
}
