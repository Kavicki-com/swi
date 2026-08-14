// src/pages/alerts/AlertsRescueRouteSelection.tsx
// /alerts/:employeeId/rescue. Reached from /alerts/:id
// after pressing "Criar rota de socorro". Replaces the map with a list of
// candidate rescuers (ranked, with one "Melhor opção de ajuda" highlight).
// Header (search + chips) mirrors AlertsList so the screen feels continuous.
import { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar, Button, Chip, Icon, SearchInput, Text, useTheme } from '@kavicki/swi-design-system'
import { rankRescueCandidates, type RescueCandidate } from '@/services/api/rescue'
import { employeesApi, type Employee } from '@/services/api/users'
import { useLivePositions } from '@/hooks/useLivePositions'
import { formatAge } from '@/lib/formatAge'

const FILTER_CHIPS = [
  { value: 'all', label: 'Todos' },
  { value: 'good', label: 'Sem incidentes' },
  { value: 'alert', label: 'Risco de incidente' },
  { value: 'low', label: 'Urgência médica' },
] as const

export function AlertsRescueRouteSelection() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { employeeId } = useParams<{ employeeId?: string }>()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  // Socorristas REAIS: posições ao vivo cruzadas com o diretório da empresa,
  // pra que a lista só ofereça gente que existe no quadro.
  const positions = useLivePositions()
  const [directory, setDirectory] = useState<ReadonlyArray<Employee>>([])

  useEffect(() => {
    let cancelled = false
    employeesApi.list().then(({ data }) => {
      if (!cancelled && data) setDirectory(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const candidates: RescueCandidate[] = useMemo(
    () => (employeeId ? rankRescueCandidates(employeeId, positions ?? [], directory) : []),
    [employeeId, positions, directory],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return candidates.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false
      if (filter !== 'all' && c.healthStatus !== filter) return false
      return true
    })
  }, [candidates, search, filter])

  return (
    <View testID="alerts-rescue-route-selection" style={{ gap: theme.gap.m, flex: 1 }}>
      <SearchInput
        value={search}
        onChangeText={setSearch}
        placeholder="Pesquisar"
        onClear={() => setSearch('')}
      />

      <View style={{ flexDirection: 'row', gap: theme.gap.s, flexWrap: 'wrap' }}>
        {FILTER_CHIPS.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            variant={filter === c.value ? 'filled' : 'outline'}
            onPress={() => setFilter(c.value)}
          />
        ))}
      </View>

      <View style={{ gap: theme.gap.xs }}>
        {filtered.map((c) => (
          <Pressable
            key={c.id}
            accessibilityLabel={`Selecionar ${c.name}`}
            onPress={() => navigate(`/alerts/${employeeId ?? ''}/rescue/${c.id}`)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: theme.surface.standard,
              borderRadius: theme.border.radius.m,
              paddingHorizontal: theme.padding.m,
              paddingVertical: theme.padding.s,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 32 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
                <Avatar uri={c.avatarUri} customSize={64} accessibilityLabel={c.name} />
                <View style={{ flexDirection: 'column', gap: theme.gap.xs, width: 145 }}>
                  <Text variant="body.m" color={theme.content.dark}>
                    {c.name}
                  </Text>
                  <Text variant="body.m" color={theme.content.dark}>
                    {formatAge(c.age)}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Icon name="humidity_mid" size={20} color={theme.content.error} />
                    <Text
                      variant="body.m"
                      color={theme.content.dark}
                      style={{ fontWeight: '500', fontSize: 16 }}
                    >
                      {c.bloodType}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ width: 1, height: 56, backgroundColor: theme.surface.high }} />

              <View style={{ width: 186 }}>
                <Text variant="body.m" color={theme.content.dark}>
                  {`${c.distanceKm} Km de distância\n${c.etaMinutes} minutos`}
                </Text>
              </View>

              <View style={{ width: 1, height: 56, backgroundColor: theme.surface.high }} />

              <View style={{ width: 160, alignItems: 'flex-start' }}>
                {c.isBestOption ? (
                  <Text
                    variant="body.m"
                    color={theme.content.success}
                    style={{ fontWeight: '700' }}
                  >
                    Melhor opção de ajuda
                  </Text>
                ) : null}
              </View>
            </View>

            <Button
              label="Selecionar"
              backgroundColor={theme.surface.primary}
              onPress={() => navigate(`/alerts/${employeeId ?? ''}/rescue/${c.id}`)}
            />
          </Pressable>
        ))}
      </View>
    </View>
  )
}
