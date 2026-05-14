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
import { Button, Combobox, ReportCard, SearchInput, useTheme } from '@kavicki/swi-design-system'
import { reportsApi, type Report } from '@/services/mockApi/reports'

const STATUS_OPTIONS = [
  { label: 'Todos', value: 'all' },
  { label: 'Concluído', value: 'accept' },
  { label: 'Em Andamento', value: 'info' },
  { label: 'Em Revisão', value: 'pending' },
  { label: 'Cancelado', value: 'canceled' },
]

const SECTOR_OPTIONS = [
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

export function ReportsList() {
  const theme = useTheme()
  const navigate = useNavigate()
  const [reports, setReports] = useState<ReadonlyArray<Report>>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [sector, setSector] = useState('nordeste')
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
        return true
      }),
    [reports, search, status],
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

      {/* Row 2 — 4 compact filters (Status / Setor / Autor / Período). */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: theme.gap.m,
          flexWrap: 'wrap',
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

      {/* Grid 4 × N — width-pinned wrapper around each DS ReportCard so
          flexWrap keeps cards uniform regardless of summary/author length. */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: theme.gap.m,
        }}
      >
        {filtered.map((r) => (
          <View key={r.id} style={{ width: 224 }}>
            <ReportCard
              status={r.status}
              statusLabel={r.statusLabel}
              title={r.title}
              summary={r.summary}
              creationDate={r.creationDate}
              author={{ name: r.authorName, avatarUri: r.authorAvatarUri }}
              location={r.sector}
              responsibles={r.responsibles}
              onPress={() => navigate(`/reports/${r.id}`)}
              fullWidth
            />
          </View>
        ))}
      </View>
    </View>
  )
}
