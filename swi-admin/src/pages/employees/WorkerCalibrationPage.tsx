// src/pages/employees/WorkerCalibrationPage.tsx
// /employees/:id/faixas: as faixas aprendidas de um funcionário, as travas de
// proteção e o histórico de mudanças. Admin e supervisor corrigem faixas; só o
// admin mexe nas travas. A aba mora na URL (?aba=travas, ?aba=historico),
// como em /cameras, para o link abrir direto nela.
//
// Sem desenho no Figma: a tela compõe Tabs, Title, Text, Button, Icon e
// SkeletonList do DS como estão.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Icon, SkeletonList, Tabs, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { employeesApi } from '@/services/api/users'
import type { CalibrationDetail } from '@/services/api/calibration'
import { calibratingLabel, recalibratingLabel } from '@/services/vitals/calibrationView'
import { useWorkerCalibration } from './hooks/useWorkerCalibration'
import { CalibrationBandsTab } from './components/CalibrationBandsTab'
import { CalibrationSafetyTab } from './components/CalibrationSafetyTab'
import { CalibrationHistoryTab } from './components/CalibrationHistoryTab'

type Tab = 'bands' | 'safety' | 'history'

const TABS = [
  { value: 'bands', label: 'Faixas' },
  { value: 'safety', label: 'Travas' },
  { value: 'history', label: 'Histórico' },
]

// Faixas é a aba padrão e fica sem parâmetro.
const PARAM_OF: Record<Tab, string | null> = { bands: null, safety: 'travas', history: 'historico' }

const tabOf = (param: string | null): Tab =>
  param === 'travas' ? 'safety' : param === 'historico' ? 'history' : 'bands'

function phaseLabel(detail: CalibrationDetail): string {
  if (detail.day === null) return 'Calibrado'
  return detail.recalibrating ? recalibratingLabel(detail.day) : calibratingLabel(detail.day)
}

/** Nome para o cabeçalho; a página funciona sem ele se a leitura falhar. */
function useWorkerName(id: string | undefined): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    if (!id) return
    let cancelled = false
    employeesApi.get(id).then(({ data }) => {
      if (!cancelled) setName(data?.name ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [id])
  return name
}

export function WorkerCalibrationPage() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const isAdmin = useAuth().user?.level === 'ADMIN'
  const name = useWorkerName(id)
  const calibration = useWorkerCalibration(id)
  const { detail, loading, error, retry } = calibration

  const tab = tabOf(params.get('aba'))
  const changeTab = (next: string) => {
    const param = PARAM_OF[next as Tab] ?? null
    setParams(param ? { aba: param } : {}, { replace: true })
  }

  return (
    <View testID="worker-calibration-page" style={{ gap: theme.gap.m }}>
      <View style={{ alignSelf: 'flex-start' }}>
        {/* Destino explícito: a página pode ser a primeira entrada do histórico. */}
        <Button
          label="Voltar"
          variant="ghost"
          accessibilityLabel="Voltar para o perfil do funcionário"
          onPress={() => navigate(`/employees/${id ?? ''}`)}
          iconLeft={
            <Icon name="keyboard_arrow_left" size={16} color={theme.content.primaryLight} />
          }
        />
      </View>

      <View style={{ gap: theme.gap.xs }}>
        <Title variant="title.s" color={theme.content.primary}>
          Faixas e travas
        </Title>
        {name ? (
          <Text testID="worker-calibration-name" variant="body.m" color={theme.content.dark}>
            {name}
          </Text>
        ) : null}
        {detail ? (
          <Text testID="worker-calibration-phase" variant="body.s" color={theme.content.medium}>
            {phaseLabel(detail)}
          </Text>
        ) : null}
      </View>

      <View style={{ alignSelf: 'flex-start' }}>
        <Tabs
          tabs={TABS}
          value={tab}
          onChange={changeTab}
          variant="separated"
          accessibilityLabel="Seção da calibração"
        />
      </View>

      {tab === 'history' && id ? (
        // O histórico tem leitura própria e relê a cada vez que a aba abre.
        <CalibrationHistoryTab workerId={id} />
      ) : loading ? (
        <SkeletonList
          testID="worker-calibration-loading"
          rows={3}
          lines={3}
          avatarSize={null}
          accessibilityLabel="Carregando a calibração"
        />
      ) : error || !detail ? (
        <View style={{ gap: theme.gap.s, alignItems: 'flex-start' }}>
          <Text testID="worker-calibration-error" variant="body.m" color={theme.content.error}>
            {error ?? 'Falha ao carregar a calibração'}
          </Text>
          <Button label="Tentar de novo" variant="outline" onPress={retry} />
        </View>
      ) : tab === 'safety' ? (
        <CalibrationSafetyTab
          safety={detail.safety}
          canEdit={isAdmin}
          onSave={calibration.setSafety}
          onRevert={calibration.revertSafety}
        />
      ) : (
        <CalibrationBandsTab
          metrics={detail.metrics}
          onSave={calibration.setBand}
          onRevert={calibration.revertBand}
        />
      )}
    </View>
  )
}
