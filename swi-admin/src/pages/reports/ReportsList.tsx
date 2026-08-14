// src/pages/reports/ReportsList.tsx
// Relatórios. Lives inside AppLayout.
//
// Uses the DS `ReportCard` as-is. Card layout (status pill top + title in
// content.primary + Resumo/Data de criação/Autor (with sector on the
// right)/Responsáveis sections) matches the reference. Width is
// pinned at 246 + min-height so the 4×N grid is uniform.
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import { Button, Combobox, SearchInput, Text, useTheme } from '@kavicki/swi-design-system'
import { reportsApi, type Report } from '@/services/api/reports'
import { ReportCardV2 } from '@/components/ReportCardV2'

const STATUS_OPTIONS = [
  { label: 'Todos', value: 'all' },
  { label: 'Concluído', value: 'accept' },
  { label: 'Em Andamento', value: 'info' },
  { label: 'Em Revisão', value: 'pending' },
  { label: 'Cancelado', value: 'canceled' },
]

// Setor e Autor saem dos relatórios CARREGADOS. Uma lista fixa ofereceria gente
// que não existe no backend, e filtrar por ela devolve vazio. Opção só existe
// se há relatório correspondente.
const ALL = 'all'

// Cards desenhados por vez. 24 são 6 linhas na grade de 4 colunas do admin, o
// que enche a tela sem transformar a página num scroll infinito.
const PAGE_SIZE = 24

function optionsFrom(
  reports: ReadonlyArray<Report>,
  pick: (r: Report) => string,
  allLabel: string,
): Array<{ label: string; value: string }> {
  const seen = Array.from(new Set(reports.map(pick).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  )
  return [{ label: allLabel, value: ALL }, ...seen.map((v) => ({ label: v, value: v }))]
}

const PERIOD_OPTIONS = [
  // Default honesto: sem recorte. Antes o default era um intervalo de datas
  // fixo ("de 11/07/2025 até 25/04/2026") que NÃO filtrava nada.
  { label: 'Todo o período', value: ALL },
  { label: 'Últimos 30 dias', value: '30d' },
  { label: 'Últimos 90 dias', value: '90d' },
]

// Parse BR-format dd/mm/yyyy creation dates from the report seed.
// Defaults guard against malformed strings so the function stays
// total under strict TS (noUncheckedIndexedAccess).
function parseBRDate(value: string): Date {
  const [day = 1, month = 1, year = 1970] = value.split('/').map(Number)
  return new Date(year, month - 1, day)
}

export function ReportsList() {
  const theme = useTheme()
  const navigate = useNavigate()
  const [reports, setReports] = useState<ReadonlyArray<Report>>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(ALL)
  const [sector, setSector] = useState(ALL)
  const [author, setAuthor] = useState(ALL)
  const [period, setPeriod] = useState(ALL)

  // Total da empresa, vindo do header do backend. Enquanto
  // `reports.length < total` há relatório que a tela AINDA não tem, e sem este
  // número o excedente ficaria de fora sem nenhum aviso.
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  // Quantos cards desenhar. Sem isto a página virava um scroll de 14.000 px.
  const [visible, setVisible] = useState(PAGE_SIZE)

  useEffect(() => {
    let cancelled = false
    reportsApi.list().then(({ data, count }) => {
      if (cancelled || !data) return
      setReports(data)
      setTotal(count ?? data.length)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const loadMore = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    const { data, count } = await reportsApi.list({ offset: reports.length })
    setLoadingMore(false)
    if (!data) return
    setReports((cur) => [...cur, ...data])
    setTotal((cur) => count ?? cur)
  }

  // Opções derivadas do que existe: nunca oferece um filtro que devolve vazio.
  const sectorOptions = useMemo(
    () => optionsFrom(reports, (r) => r.sector, 'Todos os setores'),
    [reports],
  )
  const authorOptions = useMemo(
    () => optionsFrom(reports, (r) => r.authorName, 'Todos os autores'),
    [reports],
  )

  const filtered = useMemo(
    () =>
      reports.filter((r) => {
        if (search.trim() && !r.title.toLowerCase().includes(search.toLowerCase())) return false
        if (status !== ALL && r.status !== status) return false
        // Comparação por valor exato — as opções SÃO os valores dos relatórios.
        if (sector !== ALL && r.sector !== sector) return false
        if (author !== ALL && r.authorName !== author) return false
        if (period !== ALL) {
          // Janela contada do dia de HOJE. Âncora fixa numa data recortaria o
          // período errado assim que os dados avançassem.
          const days = period === '30d' ? 30 : 90
          const cutoff = new Date(Date.now() - days * 86_400_000)
          if (parseBRDate(r.creationDate) < cutoff) return false
        }
        return true
      }),
    [reports, search, status, sector, author, period],
  )

  return (
    <View testID="reports-list" style={{ gap: theme.gap.m }}>
      {/* Row 1 — Pesquisar relatório (flex) + Novo relatório CTA right
          (puts search above filters, not below). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <View style={{ flex: 1 }}>
          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder="Pesquisar relatório"
            onClear={() => setSearch('')}
          />
        </View>
        <Button
          label="Novo relatório"
          variant="contained"
          onPress={() => navigate('/reports/new')}
          accessibilityLabel="Criar novo relatório"
        />
      </View>

      {/* Row 2 — 4 compact filters (Status / Setor / Autor / Período).
          position:relative + zIndex lifts the filter row above the ReportCard
          grid below so Combobox dropdown panels overlay the cards instead of
          being painted under them. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: theme.gap.m,
          flexWrap: 'wrap',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <View style={{ width: 160 }}>
          <Combobox
            label="Status do relatório"
            options={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
            accessibilityLabel="Filtrar por status"
          />
        </View>
        <View style={{ width: 160 }}>
          <Combobox
            label="Setor"
            options={sectorOptions}
            value={sector}
            onChange={setSector}
            accessibilityLabel="Filtrar por setor"
          />
        </View>
        <View style={{ width: 220 }}>
          <Combobox
            label="Autor do relatório"
            options={authorOptions}
            value={author}
            onChange={setAuthor}
            accessibilityLabel="Filtrar por autor"
          />
        </View>
        <View style={{ width: 260 }}>
          <Combobox
            label="Período"
            options={PERIOD_OPTIONS}
            value={period}
            onChange={setPeriod}
            accessibilityLabel="Filtrar por período"
          />
        </View>
      </View>

      {/* Card grid with auto-fill cells. The 220 px minimum keeps the
          4-column density the design calls for at the admin viewport, and
          theme.gap.l between cells provides the breathing space the client
          asked for. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: theme.gap.l,
          width: '100%',
        }}
      >
        {filtered.slice(0, visible).map((r) => (
          <ReportCardV2
            key={r.id}
            status={r.status}
            statusLabel={r.statusLabel}
            title={r.title}
            summary={r.summary}
            creationDate={r.creationDate}
            authorName={r.authorName}
            authorAvatarUri={r.authorAvatarUri}
            sector={r.sector}
            responsibleAvatars={r.responsibleAvatars}
            responsibleTotalCount={r.responsibleTotalCount}
            onPress={() => navigate(`/reports/${r.id}`)}
          />
        ))}
      </div>

      {/* Rodapé honesto: quantos estão à vista, quantos existem, e como ver o
          resto. Nada de esconder registro em silêncio. */}
      <View
        testID="reports-footer"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.gap.m,
        }}
      >
        <Text variant="body.s" color={theme.content.medium}>
          {`Mostrando ${Math.min(visible, filtered.length)} de ${filtered.length}`}
          {filtered.length < total ? ` (${total} no total)` : ''}
        </Text>
        {visible < filtered.length ? (
          <Button
            label="Ver mais"
            variant="outline"
            accessibilityLabel="Ver mais relatórios"
            onPress={() => setVisible((v) => v + PAGE_SIZE)}
          />
        ) : reports.length < total ? (
          <Button
            label={loadingMore ? 'Carregando…' : 'Carregar mais do servidor'}
            variant="outline"
            disabled={loadingMore}
            accessibilityLabel="Carregar mais relatórios do servidor"
            onPress={() => void loadMore()}
          />
        ) : null}
      </View>
    </View>
  )
}
