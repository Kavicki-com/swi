import { View } from 'react-native'
import { Button, Text, useTheme } from '@kavicki/swi-design-system'
import { MIN_AREA_VERTICES } from '@/lib/areaDraft'

export type EvacuationDrawStep = 'area' | 'muster'

// Barra do fluxo de dois passos de "Iniciar evacuação": primeiro a área
// demarcada no mapa, depois o ponto de encontro (um clique). Composição DS
// (Text + Button); saiu de AlertsList.tsx, que já estava perto do teto de
// linhas. O passo do ponto só abre com a área fechada: o gestor fecha o
// trajeto clicando no primeiro ponto, e a frase diz o que falta.
export function EvacuationDrawToolbar({
  step,
  vertexCount,
  closed,
  hasMuster,
  onUndo,
  onCancel,
  onNext,
  onBack,
  onConfirm,
}: {
  step: EvacuationDrawStep
  vertexCount: number
  closed: boolean
  hasMuster: boolean
  onUndo: () => void
  onCancel: () => void
  onNext: () => void
  onBack: () => void
  onConfirm: () => void
}) {
  const theme = useTheme()
  // Frase do passo da área: com o trajeto aberto, diz o que falta (mais pontos
  // ou fechar no primeiro); fechado, confirma.
  const points = `${vertexCount} ${vertexCount === 1 ? 'ponto' : 'pontos'}`
  const action =
    vertexCount >= MIN_AREA_VERTICES
      ? 'Toque no primeiro ponto para fechar a área'
      : 'Toque no mapa para marcar a área'
  const hint = closed ? `Área fechada, ${vertexCount} pontos` : `${action} (${points})`
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
            {hint}
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
            disabled={!closed}
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
