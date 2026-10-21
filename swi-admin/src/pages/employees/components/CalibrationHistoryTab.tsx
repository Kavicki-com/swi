// Aba "Histórico" da página de calibração: quem mudou o quê e quando, do mais
// novo para o mais antigo, com "Carregar mais" pelo cursor. O de e o para vêm
// como JSON livre e viram frase em calibrationFields, que lê com desconfiança.
import { View } from 'react-native'
import { Button, SkeletonList, Text, Title, useTheme } from '@kavicki/swi-design-system'
import type { CalibrationHistoryItem } from '@/services/api/calibration'
import { whenLabel } from '@/lib/whenLabel'
import { ACTION_LABELS, actorLabelOf, changeTargetOf, changeValueLabel } from '../calibrationFields'
import { useCalibrationHistory } from '../hooks/useWorkerCalibration'

export function CalibrationHistoryTab({ workerId }: { workerId: string }) {
  const theme = useTheme()
  const { items, hasMore, loading, loadingMore, error, moreError, retry, loadMore } =
    useCalibrationHistory(workerId)

  if (loading) {
    return (
      <SkeletonList
        testID="history-loading"
        rows={3}
        lines={3}
        avatarSize={null}
        accessibilityLabel="Carregando o histórico"
      />
    )
  }
  if (error) {
    return (
      <View style={{ gap: theme.gap.s, alignItems: 'flex-start' }}>
        <Text testID="history-error" variant="body.m" color={theme.content.error}>
          {error}
        </Text>
        <Button label="Tentar de novo" variant="outline" onPress={retry} />
      </View>
    )
  }
  if (items.length === 0) {
    return (
      <Text testID="history-empty" variant="body.m" color={theme.content.medium}>
        Nenhuma mudança registrada.
      </Text>
    )
  }

  // Um relógio por montagem basta: o histórico não fica aberto por horas.
  const now = Date.now()
  return (
    <View testID="calibration-history" style={{ gap: theme.gap.s }}>
      {items.map((item) => (
        <HistoryRow key={item.id} item={item} now={now} />
      ))}
      {moreError ? (
        <Text testID="history-more-error" variant="body.s" color={theme.content.error}>
          {moreError}
        </Text>
      ) : null}
      {hasMore ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button
            label={loadingMore ? 'Carregando…' : 'Carregar mais'}
            variant="outline"
            accessibilityLabel="Carregar mais"
            disabled={loadingMore}
            onPress={() => void loadMore()}
          />
        </View>
      ) : null}
    </View>
  )
}

function HistoryRow({ item, now }: { item: CalibrationHistoryItem; now: number }) {
  const theme = useTheme()
  const target = changeTargetOf(item)
  const action = ACTION_LABELS[item.action] ?? 'Mudança'
  return (
    <View
      testID={`history-item-${item.id}`}
      style={{
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        padding: theme.padding.m,
        gap: theme.gap.xs,
      }}
    >
      <Title variant="title.xs" color={theme.content.dark}>
        {target ? `${action}: ${target}` : action}
      </Title>
      <Text variant="body.s" color={theme.content.medium}>
        {`${actorLabelOf(item)}, ${whenLabel(item.at, now) ?? 'em data desconhecida'}`}
      </Text>
      <Text variant="body.s" color={theme.content.dark}>
        {`De: ${changeValueLabel(item, 'from')}`}
      </Text>
      <Text variant="body.s" color={theme.content.dark}>
        {`Para: ${changeValueLabel(item, 'to')}`}
      </Text>
    </View>
  )
}
