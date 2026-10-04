// Lista das câmeras cadastradas: seleção para visualizar e as ações de editar
// e excluir de cada linha.
import { Pressable, View } from 'react-native'
import { Button, Icon, Text, useTheme } from '@kavicki/swi-design-system'
import type { Camera } from '@/services/api/cameras'
import { cameraViewOf } from '../cameraView'

const ADDRESS_LABEL = {
  embed: 'Abre no painel',
  link: 'Abre em nova aba',
  none: 'Sem endereço',
} as const

export function CameraList({
  cameras,
  selectedId,
  onSelect,
  onEdit,
  onRemove,
}: {
  cameras: ReadonlyArray<Camera>
  selectedId: string | null
  onSelect: (camera: Camera) => void
  onEdit: (camera: Camera) => void
  onRemove: (camera: Camera) => void
}) {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.gap.s }}>
      {cameras.map((camera) => {
        const selected = camera.id === selectedId
        return (
          <View
            key={camera.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.gap.s,
              padding: theme.padding.s,
              borderRadius: theme.border.radius.m,
              backgroundColor: selected ? theme.surface.high : theme.surface.medium,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Ver câmera ${camera.name}`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(camera)}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}
            >
              <Icon name="video_camera_filled" size={20} color={theme.content.primary} />
              <View style={{ flex: 1, gap: theme.gap.xs }}>
                <Text variant="body.m" weight="bold" color={theme.content.dark} numberOfLines={1}>
                  {camera.name}
                </Text>
                <Text variant="body.s" color={theme.content.dark}>
                  {ADDRESS_LABEL[cameraViewOf(camera.url).kind]}
                </Text>
              </View>
            </Pressable>
            <Button
              label="Editar"
              variant="ghost"
              accessibilityLabel={`Editar ${camera.name}`}
              onPress={() => onEdit(camera)}
            />
            <Button
              label="Excluir"
              variant="ghost"
              accessibilityLabel={`Excluir ${camera.name}`}
              onPress={() => onRemove(camera)}
            />
          </View>
        )
      })}
    </View>
  )
}
