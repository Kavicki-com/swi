// Cartão sobre o pino selecionado em /alerts (frame alerts-rescue-route): o
// EmployeeOverviewCard do DS com a leitura real do funcionário e a ação "Criar
// rota de socorro". Composição de página: só arranja componentes do DS.
//
// Quem pediu ajuda pelo app ganha a etiqueta "Pedido de ajuda" e a borda do
// alerta urgente, aberto ou atendido, até o pedido fechar. Atendido, o
// cartão fica sem "Criar rota de socorro".
import { useState } from 'react'
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
import { clampOverlay } from '@/lib/clampOverlay'

export const HELP_REQUEST_LABEL = 'Pedido de ajuda'

// O cartão nasce à direita do pino e acima dele.
const OFFSET_X = 8
const OFFSET_Y = -120
// Quanto o X de fechar sai da caixa do cartão, para cima e para a direita.
const CLOSE_OVERHANG = 10

export function SelectedWorkerCard({
  marker,
  entry,
  position,
  mapSize,
  onClose,
  onCreateRescue,
}: {
  marker: DashboardMapMarker
  entry: AdminWorkerEntry | undefined
  /** Ponto do pino na tela, em px do contêiner do mapa. */
  position: { left: number; top: number }
  /** Tamanho do contêiner do mapa: o cartão não passa da borda dele. */
  mapSize: { width: number; height: number }
  onClose: () => void
  onCreateRescue: () => void
}) {
  const theme = useTheme()
  // Medida própria do cartão; até chegar, ele fica onde o pino manda.
  const [size, setSize] = useState({ width: 0, height: 0 })
  const left = clampOverlay({
    anchor: position.left,
    offset: OFFSET_X,
    size: size.width,
    container: mapSize.width,
    overhangEnd: CLOSE_OVERHANG,
  })
  const top = clampOverlay({
    anchor: position.top,
    offset: OFFSET_Y,
    size: size.height,
    container: mapSize.height,
    overhangStart: CLOSE_OVERHANG,
  })
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
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout
        setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
      }}
      style={{
        position: 'absolute',
        left,
        top,
        // O react-native-web mede depois do primeiro quadro: até a medida
        // chegar o cartão fica invisível, senão pisca fora da contenção.
        opacity: size.width > 0 ? 1 : 0,
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
          top: -CLOSE_OVERHANG,
          right: -CLOSE_OVERHANG,
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
