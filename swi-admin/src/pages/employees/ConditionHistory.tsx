// Bloco "Histórico de condições" do detalhe do funcionário, irmão do bloco
// "Aparelho": toda condição, aberta ou fechada, da mais nova para a mais
// antiga, com o motivo de cada fechamento. O gestor audita sem confundir
// pulseira que parou de medir com valor que voltou ao normal.
//
// Três formas de linha:
// - condição ao vivo: aberta e encerrada, com o motivo;
// - episódio atrasado (abriu e fechou dentro do lote da pulseira, por isso tem
//   `receivedAt`): medido, encerrado e recebido, com o motivo;
// - episódios repetidos: o rótulo do tipo original, o terceiro episódio medido
//   e o recebido. Nasce encerrada, então não leva motivo.
// Composição de primitivos do DS (Text, Title, StatusTag, Button).
import { ScrollView, View } from 'react-native'
import {
  Button,
  StatusTag,
  Text,
  Title,
  useTheme,
  type StatusTagStatus,
} from '@kavicki/swi-design-system'
import type { ConditionHistoryItem, ConditionRecoveryReason } from '@/services/api/telemetry'
import { CATEGORY_LABEL, RECOVERY_REASON_LABEL, describeCondition } from '@/services/api/monitoring'
import { whenLabel } from '@/lib/whenLabel'
import { useConditionHistory } from './hooks/useConditionHistory'

// Rolagem própria a partir de umas quatro linhas, como o histórico de exames
// logo abaixo, para a coluna do perfil não crescer sem fim.
const LIST_MAX_HEIGHT = 420

// Verde só para o que de fato se resolveu; silêncio e vencimento não são melhora.
const REASON_TONE: Record<ConditionRecoveryReason, StatusTagStatus> = {
  NORMALIZED: 'accept',
  SIGNAL_RESTORED: 'accept',
  SIGNAL_LOST: 'info',
  NO_NEW_READING: 'info',
  PROFILE_RETIRED: 'info',
}

export function ConditionHistory({ workerId }: { workerId: string }) {
  const theme = useTheme()
  const { items, hasMore, loading, loadingMore, failed, moreFailed, retry, loadMore } =
    useConditionHistory(workerId)

  const heading = (
    <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
      Histórico de condições
    </Text>
  )

  if (loading) {
    return (
      <View testID="condition-history-loading" style={{ gap: theme.gap.s }}>
        {heading}
        <Text variant="body.s" color={theme.content.medium}>
          Carregando o histórico…
        </Text>
      </View>
    )
  }

  if (failed) {
    return (
      <View testID="condition-history-error" style={{ gap: theme.gap.s }}>
        {heading}
        <Text variant="body.s" color={theme.content.medium}>
          Não foi possível carregar o histórico.
        </Text>
        <Button
          label="Tentar de novo"
          variant="outline"
          accessibilityLabel="Tentar carregar o histórico de novo"
          onPress={retry}
        />
      </View>
    )
  }

  if (items.length === 0) {
    return (
      <View testID="condition-history-empty" style={{ gap: theme.gap.s }}>
        {heading}
        <Text variant="body.s" color={theme.content.medium}>
          Nenhuma condição registrada.
        </Text>
      </View>
    )
  }

  // Um relógio por render basta: a lista relê a cada condição nova.
  const now = Date.now()
  return (
    <View testID="condition-history" style={{ gap: theme.gap.s }}>
      {heading}
      <ScrollView
        style={{ maxHeight: LIST_MAX_HEIGHT }}
        contentContainerStyle={{ gap: theme.gap.s }}
      >
        {items.map((item) => (
          <ConditionRow key={item.id} item={item} now={now} />
        ))}
        {moreFailed ? (
          <Text variant="body.s" color={theme.content.error}>
            Não foi possível carregar mais condições.
          </Text>
        ) : null}
        {hasMore ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <Button
              label={loadingMore ? 'Carregando…' : 'Carregar mais'}
              variant="outline"
              accessibilityLabel="Carregar mais condições"
              disabled={loadingMore}
              onPress={() => void loadMore()}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

function ConditionRow({ item, now }: { item: ConditionHistoryItem; now: number }) {
  const theme = useTheme()
  const { title, description } = describeCondition(item)
  const when = (iso: string) => whenLabel(iso, now) ?? 'em data desconhecida'
  const repeated = item.kind === 'REPEATED_EPISODES'
  // O pedido de ajuda nasce encerrado no instante em que abre: só a abertura
  // conta, e o estado do pedido (aberto, atendido, fechado) mora no alerta.
  const help = item.kind === 'HELP_REQUESTED'
  // Só o episódio atrasado tem a hora de chegada do lote além dos repetidos.
  const delayed = !repeated && item.receivedAt !== null

  const lines: string[] = []
  if (repeated) {
    lines.push(`Terceiro episódio medido ${when(item.openedAt)}`)
    if (item.receivedAt) lines.push(`Recebido ${when(item.receivedAt)}`)
  } else if (delayed) {
    lines.push(`Medido ${when(item.openedAt)}`)
    if (item.recoveredAt) lines.push(`Encerrado ${when(item.recoveredAt)}`)
    if (item.receivedAt) lines.push(`Recebido ${when(item.receivedAt)}`)
  } else {
    lines.push(`Aberta ${when(item.openedAt)}`)
    if (item.recoveredAt && !help) lines.push(`Encerrada ${when(item.recoveredAt)}`)
  }

  const category = CATEGORY_LABEL[item.category]
  return (
    <View
      testID={`condition-history-item-${item.id}`}
      style={{
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        padding: theme.padding.m,
        gap: theme.gap.xs,
      }}
    >
      <Title variant="title.xs" color={theme.content.dark}>
        {title}
      </Title>
      <Text variant="body.s" color={theme.content.medium}>
        {delayed ? `${category}, episódio atrasado` : category}
      </Text>
      <Text variant="body.s" color={theme.content.dark}>
        {description}
      </Text>
      {lines.map((line) => (
        <Text key={line} variant="body.s" color={theme.content.dark}>
          {line}
        </Text>
      ))}
      {repeated || help ? null : <StatusLine item={item} />}
      {item.origin === 'DEMO' ? (
        <Text variant="body.s" color={theme.content.medium}>
          Dados de demonstração
        </Text>
      ) : null}
    </View>
  )
}

// Aberta, ou o motivo do fechamento; fechada sem motivo conhecido diz só isso.
function StatusLine({ item }: { item: ConditionHistoryItem }) {
  if (item.status === 'ACTIVE') return <StatusTag status="pending" label="Aberta" />
  const reason = item.recoveryReason
  const known = reason !== null && reason in RECOVERY_REASON_LABEL
  return (
    <StatusTag
      status={known ? REASON_TONE[reason] : 'info'}
      label={known ? RECOVERY_REASON_LABEL[reason] : 'Encerrada'}
    />
  )
}
