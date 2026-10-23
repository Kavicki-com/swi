// Cartão sobre o pino selecionado em /alerts (frame alerts-rescue-route): o
// EmployeeOverviewCard do DS com a leitura real do funcionário e a ação "Criar
// rota de socorro". Composição de página: só arranja componentes do DS.
//
// Quem pediu ajuda pelo app ganha a etiqueta "Pedido de ajuda" e a borda do
// alerta urgente, aberto ou atendido, até o pedido fechar. Atendido, o
// cartão fica sem "Criar rota de socorro".
import { Pressable, View } from 'react-native'
import {
  Button,
  EmployeeOverviewCard,
  Icon,
  StatusTag,
  Text,
  useTheme,
} from '@kavicki/swi-design-system'
import type { DashboardMapMarker } from '@/services/dashboard'
import type { AdminWorkerEntry } from '@/services/api/telemetry'
import { DataOriginBadge } from '@/components/DataOriginBadge'
import { NO_DEVICE_LABEL, vitalsViewFrom } from '@/services/vitals/vitalsView'

export const HELP_REQUEST_LABEL = 'Pedido de ajuda'

export function SelectedWorkerCard({
  marker,
  entry,
  position,
  onClose,
  onCreateRescue,
}: {
  marker: DashboardMapMarker
  entry: AdminWorkerEntry | undefined
  /** Ponto do pino na tela, em px do contêiner do mapa. */
  position: { left: number; top: number }
  onClose: () => void
  onCreateRescue: () => void
}) {
  const theme = useTheme()
  const noDevice = entry?.device.state === 'NONE'
  const vitals = vitalsViewFrom(entry?.telemetry ?? null, { noDevice })
  // Batimento como número para o cartão do DS; null mostra a ausência.
  const heartRate = vitals.heartRate == null ? null : Number(vitals.heartRate)
  const helpRequest = entry?.helpRequest ?? null
  // A borda acompanha o estado real; o pedido de ajuda pinta como urgente.
  // Sem condição, o cartão fica com a borda padrão.
  const border =
    helpRequest || marker.status === 'low'
      ? theme.content.error
      : marker.status === 'alert'
        ? theme.content.warning
        : undefined

  return (
    <View
      testID="alerts-selected-worker"
      style={{
        position: 'absolute',
        left: position.left,
        top: position.top,
        transform: [{ translateX: 8 }, { translateY: -120 }],
        maxWidth: 602,
        zIndex: 3,
      }}
    >
      <EmployeeOverviewCard
        employee={{
          name: marker.name,
          sector: entry?.worker.sector ?? '',
          avatarUri: marker.avatarUri,
        }}
        progress={vitals.wearPct ?? undefined}
        bpm={heartRate}
        pressure={vitals.pressure ?? null}
        // Sem aparelho pareado, a frase toma a coluna de saúde do cartão (no
        // lugar do "-- Bpm"), e a linha de estado abaixo não a repete.
        absenceLabel={noDevice ? NO_DEVICE_LABEL : undefined}
        borderColor={border}
        // Pedido de ajuda já atendido tem socorro a caminho: a ação some.
        // Para os outros alertas o botão segue como sempre.
        actionElement={
          helpRequest?.status === 'ATTENDED' ? undefined : (
            <Button
              label="Criar rota de socorro"
              backgroundColor={theme.surface.primary}
              onPress={onCreateRescue}
            />
          )
        }
      />
      {/* Fechar o card: além do clique no mapa e no próprio pino, um X no
          canto do cartão. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fechar leitura do funcionário"
        onPress={onClose}
        style={{
          position: 'absolute',
          top: -10,
          right: -10,
          width: 28,
          height: 28,
          borderRadius: theme.border.radius.pill,
          backgroundColor: theme.surface.standard,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 4,
        }}
      >
        <Icon name="close" size={18} color={theme.content.dark} />
      </Pressable>
      {helpRequest ? (
        <View style={{ alignSelf: 'flex-start', marginTop: theme.gap.xs }}>
          <StatusTag testID="alerts-help-request" status="canceled" label={HELP_REQUEST_LABEL} />
        </View>
      ) : null}
      {heartRate === null && !noDevice ? (
        <Text testID="alerts-selected-status" variant="body.s" color={theme.content.medium}>
          {vitals.status ?? 'Sem leitura do aparelho'}
        </Text>
      ) : null}
      {vitals.sourceBadge ? (
        <DataOriginBadge label={vitals.sourceBadge} testID="alerts-selected-demo" />
      ) : null}
    </View>
  )
}
