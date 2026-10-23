// Barra de ações da tela Alertas, em dois grupos que não se misturam:
// Socorro (rota de socorro para uma pessoa e o histórico de resgates) e
// Evacuação (iniciar, desenhar a área, acompanhar e encerrar). As duas
// funções coexistem: durante uma evacuação o socorro continua disponível.
// Composição de página: só arranja Button, Text e Icon do DS.
import type { ReactElement } from 'react'
import { View } from 'react-native'
import { Button, Icon, Text, useTheme } from '@kavicki/swi-design-system'

export function AlertsActionBar({
  drawToolbar,
  evacuation,
  workersInArea,
  pickingRescue,
  onRescuePick,
  onRescueCancel,
  onRescues,
  onStartEvacuation,
  onEndEvacuation,
}: {
  /** Barra do desenho da área; presente só enquanto o gestor desenha. */
  drawToolbar: ReactElement | null
  evacuation: { acked: number; total: number } | null
  /** Quem está dentro da área salva; null quando a evacuação não tem área. */
  workersInArea: number | null
  pickingRescue: boolean
  onRescuePick: () => void
  onRescueCancel: () => void
  onRescues: () => void
  onStartEvacuation: () => void
  onEndEvacuation: () => void
}) {
  const theme = useTheme()
  const drawing = drawToolbar != null
  const groupTitle = (label: string) => (
    <Text variant="label.m" color={theme.content.medium}>
      {label}
    </Text>
  )

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: theme.gap.l,
      }}
    >
      <View testID="alerts-rescue-group" style={{ gap: theme.gap.xs }}>
        {groupTitle('Socorro')}
        <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
          {pickingRescue ? (
            <Button label="Cancelar" variant="outline" onPress={onRescueCancel} />
          ) : (
            <Button
              label="Rota de socorro"
              backgroundColor={theme.surface.primary}
              disabled={drawing}
              onPress={onRescuePick}
            />
          )}
          <Button label="Resgates" backgroundColor={theme.surface.secondary} onPress={onRescues} />
        </View>
      </View>

      <View testID="alerts-evacuation-group" style={{ gap: theme.gap.xs }}>
        {groupTitle('Evacuação')}
        {drawToolbar ??
          (evacuation ? (
            <View
              testID="evacuation-banner"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.gap.m,
                paddingHorizontal: theme.padding.s,
                paddingVertical: theme.padding.xs,
                borderRadius: theme.border.radius.m,
                backgroundColor: theme.surface.errorLight,
              }}
            >
              <Icon name="notifications" size={18} color={theme.content.light} />
              <Text
                variant="body.s"
                color={theme.content.light}
                style={{ fontWeight: '700' as const }}
              >
                Evacuação em andamento: {evacuation.acked}/{evacuation.total} confirmados
              </Text>
              {workersInArea != null ? (
                <Text
                  testID="evacuation-in-area"
                  variant="body.s"
                  color={theme.content.light}
                  style={{ fontWeight: '700' as const }}
                >
                  {workersInArea} dentro da área
                </Text>
              ) : null}
              <Button
                label="Encerrar evacuação"
                backgroundColor={theme.surface.error}
                onPress={onEndEvacuation}
              />
            </View>
          ) : (
            <Button
              label="Iniciar evacuação"
              backgroundColor={theme.surface.error}
              onPress={onStartEvacuation}
            />
          ))}
      </View>
    </View>
  )
}
