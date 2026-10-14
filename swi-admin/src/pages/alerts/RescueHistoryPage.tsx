// src/pages/alerts/RescueHistoryPage.tsx
// /alerts/rescues. Histórico de resgates em andamento e encerrados (MEL-12),
// alcançada por um botão na tela de Alertas. Cada resgate em andamento pode ter
// a chegada registrada (retoma a jornada do socorrista no backend) e ser
// encerrado. Compõe componentes do DS; a lógica de dados fica no useRescues.
import { useState } from 'react'
import { View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import { Button, StatusTag, Text, Title, useTheme } from '@kavicki/swi-design-system'
import type { StatusTagStatus } from '@kavicki/swi-design-system'
import { useRescues, errorMessage } from './hooks/useRescues'
import type { Rescue, RescueStatus } from '@/services/api/rescues'

const STATUS_TAG: Record<RescueStatus, { status: StatusTagStatus; label: string }> = {
  dispatched: { status: 'pending', label: 'Despachado' },
  arrived: { status: 'info', label: 'Chegou' },
  ended: { status: 'accept', label: 'Encerrado' },
}

const whenFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '--' : whenFmt.format(d)
}

export function RescueHistoryPage() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { rescues, loading, error, retry, arrive, end } = useRescues()
  const [actionError, setActionError] = useState<string | null>(null)

  const run = async (fn: Promise<void>) => {
    setActionError(null)
    try {
      await fn
    } catch (e) {
      setActionError(errorMessage(e, 'Não foi possível atualizar o resgate'))
    }
  }

  return (
    <View testID="rescue-history" style={{ gap: theme.gap.m, flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: theme.gap.s,
          flexWrap: 'wrap',
        }}
      >
        <Title variant="title.s" color={theme.content.dark}>
          Resgates
        </Title>
        <Button
          label="Voltar"
          backgroundColor={theme.surface.secondary}
          onPress={() => navigate('/alerts')}
        />
      </View>

      {loading ? (
        <Text testID="rescues-loading" variant="body.m" color={theme.content.medium}>
          Carregando resgates…
        </Text>
      ) : error ? (
        <View style={{ gap: theme.gap.s, alignItems: 'flex-start' }}>
          <Text testID="rescues-error" variant="body.m" color={theme.content.error}>
            {error}
          </Text>
          <Button
            label="Tentar novamente"
            backgroundColor={theme.surface.secondary}
            onPress={retry}
          />
        </View>
      ) : rescues.length === 0 ? (
        <Text testID="rescues-empty" variant="body.m" color={theme.content.medium}>
          Nenhum resgate registrado.
        </Text>
      ) : (
        <View style={{ gap: theme.gap.s }}>
          {actionError ? (
            <Text testID="rescues-action-error" variant="body.s" color={theme.content.error}>
              {actionError}
            </Text>
          ) : null}
          {rescues.map((r) => (
            <RescueRow
              key={r.id}
              rescue={r}
              onArrive={() => void run(arrive(r.id))}
              onEnd={() => void run(end(r.id))}
            />
          ))}
        </View>
      )}
    </View>
  )
}

function RescueRow({
  rescue,
  onArrive,
  onEnd,
}: {
  rescue: Rescue
  onArrive: () => void
  onEnd: () => void
}) {
  const theme = useTheme()
  const tag = STATUS_TAG[rescue.status]
  return (
    <View
      testID={`rescue-row-${rescue.id}`}
      style={{
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        padding: theme.padding.m,
        gap: theme.gap.s,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: theme.gap.m,
        }}
      >
        <View style={{ gap: theme.gap.xs, flexShrink: 1 }}>
          <Text variant="body.m" color={theme.content.dark}>
            {`Resgate ID ${rescue.number}`}
          </Text>
          <Text variant="body.s" color={theme.content.medium}>
            {`Ferido: ${rescue.injured.name}`}
          </Text>
          <Text variant="body.s" color={theme.content.medium}>
            {`Socorrista: ${rescue.rescuer.name}`}
          </Text>
          <Text variant="body.s" color={theme.content.medium}>
            {rescue.endedAt
              ? `Início ${formatWhen(rescue.startedAt)}, fim ${formatWhen(rescue.endedAt)}`
              : `Início ${formatWhen(rescue.startedAt)}`}
          </Text>
        </View>
        <StatusTag status={tag.status} label={tag.label} />
      </View>

      {rescue.status !== 'ended' ? (
        <View style={{ flexDirection: 'row', gap: theme.gap.s, flexWrap: 'wrap' }}>
          {rescue.status === 'dispatched' ? (
            <Button
              label="Registrar chegada"
              accessibilityLabel={`Registrar chegada do resgate ${rescue.number}`}
              backgroundColor={theme.surface.secondary}
              onPress={onArrive}
            />
          ) : null}
          <Button
            label="Encerrar"
            accessibilityLabel={`Encerrar resgate ${rescue.number}`}
            backgroundColor={theme.surface.error}
            onPress={onEnd}
          />
        </View>
      ) : null}
    </View>
  )
}
