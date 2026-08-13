// src/pages/dashboard/components/ActivitiesSection.tsx
// Bloco de atividades em andamento: abas de status, CTA de ver todos e um
// cartão por atividade (ícone, progresso colorido por risco, participantes
// e atalho para o mapa). Extraído de Dashboard.tsx.
import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  AvatarGroup,
  Button,
  Icon,
  ProgressBar,
  Tabs,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import type {
  DashboardActivity,
  DashboardActivityRisk,
  DashboardActivityStatus,
} from '@/services/dashboard'

const ACTIVITY_FILTER_CHIPS = ['Em Andamento', 'Concluídas', 'A Fazer'] as const
type ActivityFilterChip = (typeof ACTIVITY_FILTER_CHIPS)[number]
type ActivityFilter = ActivityFilterChip | 'Ver Todos'

const CHIP_TO_STATUS: Record<ActivityFilterChip, DashboardActivityStatus> = {
  'Em Andamento': 'em-curso',
  Concluídas: 'concluida',
  'A Fazer': 'a-fazer',
}

function progressColorForRisk(
  theme: ReturnType<typeof useTheme>,
  risk: DashboardActivityRisk | undefined,
): string {
  switch (risk) {
    case 'warning':
      return theme.surface.warning
    case 'critical':
      return theme.surface.error
    case 'normal':
    default:
      return theme.surface.primary
  }
}

function ActivityCard({ activity }: { activity: DashboardActivity }) {
  const theme = useTheme()
  const navigate = useNavigate()
  return (
    <View
      testID={`activity-${activity.id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.s,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.standard,
      }}
    >
      {/* content group: build icon + vertical divider + repair-info column */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.l }}>
        <Icon name="build_filled" size={24} color={theme.content.dark} />
        <View
          style={{
            alignSelf: 'stretch',
            width: 1,
            backgroundColor: theme.content.dark,
            opacity: 0.2,
          }}
        />
        <View style={{ gap: theme.gap.xs }}>
          <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' as const }}>
            {activity.title}
          </Text>
          <Text variant="body.s" color={theme.content.medium}>
            {activity.sector}
          </Text>
          {/* The reference ProgressBar is fixed 119px wide; DS ProgressBar
              stretches by default, so wrap to constrain. Color comes from the
              activity's risk level (normal/warning/critical), not its status. */}
          <View style={{ width: 119 }}>
            <ProgressBar
              value={activity.progress}
              color={progressColorForRisk(theme, activity.risk)}
              accessibilityLabel={`${activity.title} progress`}
            />
          </View>
        </View>
      </View>
      <AvatarGroup
        avatars={activity.participants}
        totalCount={activity.totalParticipants ?? activity.participants.length}
        maxVisible={5}
        size="m"
        bordered
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Abrir localização da atividade ${activity.title}`}
        onPress={() => navigate('/maps/general')}
        testID={`activity-${activity.id}-location`}
      >
        <Icon name="location_on_filled" size={24} color={theme.content.dark} />
      </Pressable>
    </View>
  )
}

export function ActivitiesSection({ activities }: { activities: DashboardActivity[] }) {
  const theme = useTheme()
  const [filter, setFilter] = useState<ActivityFilter>('Em Andamento')

  const filtered = useMemo(() => {
    if (filter === 'Ver Todos') return activities
    const status = CHIP_TO_STATUS[filter]
    return activities.filter((a) => a.status === status)
  }, [activities, filter])

  return (
    <View
      testID="activities-section"
      style={{ gap: theme.gap.m }}
    >
      <Title variant="title.s">Atividades em andamento</Title>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.gap.m,
        }}
      >
        <View testID="activities-tabs" style={{ flex: 1, minWidth: 0 }}>
          <Tabs
            tabs={ACTIVITY_FILTER_CHIPS.map((c) => ({ value: c, label: c }))}
            value={filter === 'Ver Todos' ? undefined : filter}
            onChange={(v: string) => {
              if ((ACTIVITY_FILTER_CHIPS as readonly string[]).includes(v)) {
                setFilter(v as ActivityFilterChip)
              }
            }}
            fullWidth
          />
        </View>
        <Button
          label="Ver Todos"
          variant="contained"
          size="small"
          onPress={() => setFilter('Ver Todos')}
          testID="activities-see-all"
        />
      </View>
      <View testID="activities-list" style={{ gap: theme.gap.s }}>
        {filtered.length === 0 ? (
          <Text testID="activities-empty">Nenhuma atividade nesta categoria.</Text>
        ) : (
          filtered.map((activity) => <ActivityCard key={activity.id} activity={activity} />)
        )}
      </View>
    </View>
  )
}
