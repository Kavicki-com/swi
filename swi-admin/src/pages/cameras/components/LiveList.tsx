// Quem está transmitindo agora: tocar na linha escolhe o funcionário para
// assistir. Mesma composição de componentes do DS da lista de câmeras fixas.
import { Pressable, View } from 'react-native'
import { Icon, Text, useTheme } from '@kavicki/swi-design-system'
import type { LiveBroadcast } from '@/services/api/live'

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function LiveList({
  broadcasts,
  selectedId,
  onSelect,
}: {
  broadcasts: ReadonlyArray<LiveBroadcast>
  selectedId: string | null
  onSelect: (workerId: string) => void
}) {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.gap.s }}>
      {broadcasts.map((broadcast) => {
        const selected = broadcast.workerId === selectedId
        return (
          <Pressable
            key={broadcast.workerId}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(broadcast.workerId)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.gap.s,
              padding: theme.padding.s,
              borderRadius: theme.border.radius.m,
              backgroundColor: selected ? theme.surface.high : theme.surface.medium,
            }}
          >
            <Icon name="video_camera_filled" size={20} color={theme.content.primary} />
            <View style={{ flex: 1, gap: theme.gap.xs }}>
              <Text variant="body.m" weight="bold" color={theme.content.dark} numberOfLines={1}>
                {broadcast.name}
              </Text>
              <Text variant="body.s" color={theme.content.dark}>
                {`Ao vivo desde ${timeOf(broadcast.startedAt)}`}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}
