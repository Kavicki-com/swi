import { View } from 'react-native'
import { Button, Text, useTheme } from '@kavicki/swi-design-system'

export type EvacuationDrawStep = 'area' | 'muster'

// Barra do fluxo de dois passos de "Iniciar evacuação": primeiro a área
// demarcada no mapa, depois o ponto de encontro (um clique). Composição DS
// (Text + Button); saiu de AlertsList.tsx, que já estava perto do teto de
// linhas, sem mudança de comportamento no passo da área.
export function EvacuationDrawToolbar({
  step,
  vertexCount,
  hasMuster,
  onUndo,
  onCancel,
  onNext,
  onBack,
  onConfirm,
}: {
  step: EvacuationDrawStep
  vertexCount: number
  hasMuster: boolean
  onUndo: () => void
  onCancel: () => void
  onNext: () => void
  onBack: () => void
  onConfirm: () => void
}) {
  const theme = useTheme()
  return (
    <View
      testID="evacuation-draw-toolbar"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.gap.s,
        flexWrap: 'wrap',
      }}
    >
      {step === 'area' ? (
        <>
          <Text variant="body.s" color={theme.content.medium}>
            Toque no mapa para marcar a área ({vertexCount} {vertexCount === 1 ? 'ponto' : 'pontos'}
            )
          </Text>
          <Button
            label="Desfazer"
            variant="outline"
            onPress={onUndo}
            disabled={vertexCount === 0}
          />
          <Button label="Cancelar" variant="outline" onPress={onCancel} />
          <Button
            label="Próximo: ponto de encontro"
            backgroundColor={theme.surface.error}
            disabled={vertexCount < 3}
            onPress={onNext}
          />
        </>
      ) : (
        <>
          <Text variant="body.s" color={theme.content.medium}>
            Toque no mapa para marcar o ponto de encontro
          </Text>
          <Button label="Voltar" variant="outline" onPress={onBack} />
          <Button label="Cancelar" variant="outline" onPress={onCancel} />
          <Button
            label="Confirmar e iniciar"
            backgroundColor={theme.surface.error}
            disabled={!hasMuster}
            onPress={onConfirm}
          />
        </>
      )}
    </View>
  )
}
