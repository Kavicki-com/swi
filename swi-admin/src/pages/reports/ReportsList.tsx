// src/pages/reports/ReportsList.tsx
// Relatórios — Figma 96:4091. Lives inside AppLayout.
//
// Uses the DS `ReportCard` as-is. Card layout (status pill top + title in
// content.primary + Resumo/Data de criação/Autor (with sector on the
// right)/Responsáveis sections) matches the Figma reference. Width is
// pinned at 246 + min-height so the 4×N grid is uniform.
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import { Button, Combobox, SearchInput, useTheme } from '@kavicki/swi-design-system'
import { reportsApi, type Report } from '@/services/mockApi/reports'
import { ReportCardV2 } from '@/components/ReportCardV2'

const STATUS_OPTIONS = [
  { label: 'Todos', value: 'all' },
  { label: 'Concluído', value: 'accept' },
  { label: 'Em Andamento', value: 'info' },
  { label: 'Em Revisão', value: 'pending' },
  { label: 'Cancelado', value: 'canceled' },
]

const SECTOR_OPTIONS = [
  { label: 'Todos os setores', value: 'all' },
  { label: 'Setor Nordeste', value: 'nordeste' },
  { label: 'Setor Sul', value: 'sul' },
  { label: 'Setor Centro', value: 'centro' },
]

const AUTHOR_OPTIONS = [
  { label: 'Todos os autores', value: 'all' },
  { label: 'Ana Clara Mendonça', value: 'ana' },
  { label: 'Mariana Pinto', value: 'mariana' },
  { label: 'Lucas Almeida Silva', value: 'lucas' },
]

const PERIOD_OPTIONS = [
  { label: 'Últimos 30 dias', value: '30d' },
  { label: 'Últimos 90 dias', value: '90d' },
  { label: 'de 11/07/2025 até 25/04/2026', value: 'custom' },
]

// Demo anchor: today is conceptually 2026-05-01 for the filter math, so the
// 30/90-day windows actually contain rows from the seed (newest = 12/04/2026).
// Production replaces this with new Date() against a live API.
const DEMO_TODAY = new Date(2026, 4, 1)

// Parse BR-format dd/mm/yyyy creation dates from the report seed.
// Defaults guard against malformed strings so the function stays
// total under strict TS (noUncheckedIndexedAccess).
function parseBRDate(value: string): Date {
  const [day = 1, month = 1, year = 1970] = value.split('/').map(Number)
  return new Date(year, month - 1, day)
}

const SECTOR_MATCHERS: Record<string, string> = {
  nordeste: 'Nordeste',
  sul: 'Sul',
  centro: 'Centro',
}

const AUTHOR_MATCHERS: Record<string, string> = {
  ana: 'Ana',
  mariana: 'Mariana',
  lucas: 'Lucas',
}

export function ReportsList() {
  const theme = useTheme()
  const navigate = useNavigate()
  const [reports, setReports] = useState<ReadonlyArray<Report>>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [sector, setSector] = useState('all')
  const [author, setAuthor] = useState('all')
  const [period, setPeriod] = useState('custom')

  useEffect(() => {
    let cancelled = false
    reportsApi.list().then(({ data }) => {
      if (!cancelled && data) setReports(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () =>
      reports.filter((r) => {
        if (search.trim() && !r.title.toLowerCase().includes(search.toLowerCase())) return false
        if (status !== 'all' && r.status !== status) return false
        if (sector !== 'all') {
          const needle = SECTOR_MATCHERS[sector]
          if (needle && !r.sector.includes(needle)) return false
        }
        if (author !== 'all') {
          const needle = AUTHOR_MATCHERS[author]
          if (needle && !r.authorName.includes(needle)) return false
        }
        if (period !== 'custom') {
          const days = period === '30d' ? 30 : 90
          const cutoff = new Date(DEMO_TODAY.getTime() - days * 86_400_000)
          if (parseBRDate(r.creationDate) < cutoff) return false
        }
        return true
      }),
    [reports, search, status, sector, author, period],
  )

  return (
    <View testID="reports-list" style={{ gap: theme.gap.m }}>
      {/* Row 1 — Pesquisar relatório (flex) + Novo relatório CTA right
          (Figma 96:4091 puts search above filters, not below). */}
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
            options={SECTOR_OPTIONS}
            value={sector}
            onChange={setSector}
            accessibilityLabel="Filtrar por setor"
          />
        </View>
        <View style={{ width: 220 }}>
          <Combobox
            label="Autor do relatório"
            options={AUTHOR_OPTIONS}
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

      {/* Card grid — auto-fill cells. 220 minimum keeps the 4-column density
          the QA mockup (§4) shows at the admin viewport; theme.gap.l between
          cells provides the breathing space the client asked for. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: theme.gap.l,
          width: '100%',
        }}
      >
        {filtered.map((r) => (
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
    </View>
  )
}
