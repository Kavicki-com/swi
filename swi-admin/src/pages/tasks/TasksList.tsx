// src/pages/tasks/TasksList.tsx
// /tasks — lista de tarefas (work orders). Figma 1606-11583. Vive dentro do
// AppLayout.
//
// Cada linha é o DS `ActivitiesOverviewCard` as-is: ele já traz ícone +
// divisor + título/subtítulo + ProgressBar + AvatarGroup ("+N") + pino de
// localização, que é exatamente a anatomia da linha no Figma.
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  ActivitiesOverviewCard,
  Button,
  Icon,
  SearchInput,
  Tabs,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import { ApiError } from '@/services/api/http'
import { workOrdersApi, type WorkOrderRow, type WorkOrderStatus } from '@/services/api/workOrders'

// A aba É o status do backend — sem tabela de tradução, o value da aba já é o
// que vai no query param.
const TABS: ReadonlyArray<{ value: WorkOrderStatus; label: string }> = [
  { value: 'in_progress', label: 'Em Andamento' },
  { value: 'done', label: 'Concluídas' },
  { value: 'pending', label: 'A Fazer' },
]

export function TasksList() {
  const theme = useTheme()
  const navigate = useNavigate()
  const [status, setStatus] = useState<WorkOrderStatus>('in_progress')
  const [rows, setRows] = useState<ReadonlyArray<WorkOrderRow>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Incrementado pelo "Tentar novamente": é só um gatilho pro efeito refazer a
  // busca da aba atual (o status não mudou, então ele sozinho não re-dispara).
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    workOrdersApi
      .list(status)
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // apiFetch garante ApiError em todo caminho de erro; o fallback cobre
        // só um bug de programação nosso, não um cenário de rede.
        setError(e instanceof ApiError ? e.message : 'Erro ao carregar as tarefas')
        setRows([])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status, reloadKey])

  // O backend não tem busca textual (list só filtra por status), então o
  // filtro por título/setor é client-side em cima das ≤200 linhas da aba.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(
      (r) => r.title.toLowerCase().includes(needle) || r.sector.toLowerCase().includes(needle),
    )
  }, [rows, search])

  return (
    <View testID="tasks-list" style={{ gap: theme.gap.m }}>
      <View style={{ alignSelf: 'flex-start' }}>
        {/* Destino EXPLÍCITO, não navigate(-1). /tasks é destino de primeiro
            nível e pode ser a primeira entrada do histórico: entrando por
            deep-link deslogado, RequireAuth e Login redirecionam os dois com
            `replace`, então não sobra entrada anterior e o -1 saía da SPA
            inteira. O dashboard é o pai natural na navegação do admin. */}
        <Button
          label="Voltar"
          variant="ghost"
          onPress={() => navigate('/')}
          iconLeft={
            <Icon name="keyboard_arrow_left" size={16} color={theme.content.primaryLight} />
          }
        />
      </View>

      {/* Busca larga + CTA verde "Nova Tarefa" à direita. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <View style={{ flex: 1 }}>
          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder="Pesquisar tarefa"
            onClear={() => setSearch('')}
          />
        </View>
        <Button
          label="Nova Tarefa"
          variant="contained"
          onPress={() => navigate('/tasks/new')}
          iconLeft={<Icon name="add_circle" size={18} color={theme.content.light} />}
        />
      </View>

      <Title variant="title.s" color={theme.content.primary}>
        Atividades em andamento
      </Title>

      {/* As abas ocupam ~metade da largura no Figma; fullWidth dentro de um
          wrapper de 50% dá as 3 abas iguais sem esticar até a borda. */}
      <View style={{ width: '50%' }}>
        <Tabs
          tabs={[...TABS]}
          value={status}
          onChange={(next) => {
            // Sem cast: só um value que existe em TABS vira status.
            const tab = TABS.find((t) => t.value === next)
            if (!tab) return
            setStatus(tab.value)
          }}
          variant="separated"
          fullWidth
          accessibilityLabel="Filtrar tarefas por situação"
        />
      </View>

      {loading ? (
        <Text testID="tasks-loading" variant="body.m" color={theme.content.medium}>
          Carregando tarefas…
        </Text>
      ) : error ? (
        <View style={{ alignItems: 'flex-start', gap: theme.gap.s }}>
          <Text testID="tasks-error" variant="body.m" color={theme.content.error}>
            {error}
          </Text>
          <Button
            label="Tentar novamente"
            variant="outline"
            onPress={() => setReloadKey((k) => k + 1)}
          />
        </View>
      ) : filtered.length === 0 ? (
        <Text testID="tasks-empty" variant="body.m" color={theme.content.medium}>
          Nenhuma tarefa nesta aba.
        </Text>
      ) : (
        <View style={{ gap: theme.gap.s }}>
          {filtered.map((row) => (
            <ActivitiesOverviewCard
              key={row.id}
              title={row.title}
              subtitle={row.sector}
              progress={row.progressPct}
              // Sem progressColor de propósito: no Figma a cor da barra varia
              // por linha, mas não deriva do percentual (duas linhas em ~50%
              // aparecem em verde e laranja). O atributo que define a cor não
              // existe no WorkOrderRow — pendência de backend/design. Até lá,
              // vale o default do DS.
              icon="build"
              // Título sozinho não identifica a linha: tarefas homônimas em
              // setores diferentes gerariam botões com o mesmo nome acessível.
              accessibilityLabel={`${row.title}, ${row.sector}`}
              // responsibleAvatars é index-parallel com responsibleCount e traz
              // '' pra quem não tem foto: manter a posição (não filtrar) é o
              // que faz o "+N" bater com o total de responsáveis.
              avatars={row.responsibleAvatars.map((uri) => ({ uri: uri || undefined }))}
              totalAvatarsCount={row.responsibleCount}
              onPress={() => navigate(`/tasks/${row.id}`)}
              onLocationPress={() => navigate('/maps/general')}
              locationAccessibilityLabel={`Abrir localização da tarefa ${row.title}`}
              fullWidth
            />
          ))}
        </View>
      )}
    </View>
  )
}
