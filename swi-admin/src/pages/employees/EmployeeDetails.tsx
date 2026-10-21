// src/pages/employees/EmployeeDetails.tsx
// Employee details. Three-column worker layout shared with
// AdminDetails via `WorkerDetailsLayout`. This page owns employee data
// fetching and supplies the top-right actions: "Faixas e travas" (outline,
// abre /employees/:id/faixas) and the "Solicitar Pausa" CTA (contained
// button in surface.accent, the employee-specific variant of the slot).
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { employeesApi, type Employee } from '@/services/api/users'
import { notificationsApi } from '@/services/api/notifications'
import { WorkerDetailsLayout } from '@/pages/_shared/WorkerDetailsLayout'
import { DeviceSection, type DeviceState } from '@/pages/employees/DeviceSection'
import { fullMapPath } from '@/pages/maps/mapFocus'
import { vitalsViewFrom, type ReadingOptions } from '@/services/vitals/vitalsView'
import { measurementsViewFrom } from '@/services/vitals/measurementsView'
import { useLivePositions } from '@/hooks/useLivePositions'
import { useNow } from '@/hooks/useNow'
import { POSITION_CLOCK_MS, stalePositionNote } from '@/services/positions/positionAge'
import { useWorkerTelemetry } from '@/hooks/useWorkerTelemetry'
import { useDemoToast } from '@/lib/demoToast'

export function EmployeeDetails() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  const { id } = useParams<{ id: string }>()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [pausing, setPausing] = useState(false)
  // Mini-mapa: posição REAL deste funcionário. Coordenada fixa aqui colocaria
  // todo mundo no mesmo ponto.
  const positions = useLivePositions()
  const position = positions?.find((p) => p.id === id) ?? null
  // Relógio de tela para a hora da posição velha envelhecer sem recarregar.
  const now = useNow(POSITION_CLOCK_MS)
  // Vitais do aparelho pareado, relidos sozinhos enquanto a página está aberta.
  const { telemetry, failed } = useWorkerTelemetry(id)
  // Quem sabe se há aparelho é o bloco Aparelho. Até ele responder, os vitais
  // não mostram a leitura guardada, que pode ser de quem já despareou.
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null)

  // POST real: o worker recebe a notificação de journey no app, e erro do
  // backend aparece no toast.
  const requestPause = async (target: Employee) => {
    setPausing(true)
    const { error } = await notificationsApi.requestPause(target.id)
    setPausing(false)
    if (error) {
      showToast('Falha ao solicitar pausa', error.message)
      return
    }
    showToast('Pausa solicitada', `${target.name} foi notificado para pausar a atividade`)
  }

  useEffect(() => {
    let cancelled = false
    if (!id) return
    employeesApi.get(id).then(({ data }) => {
      if (!cancelled) {
        setEmployee(data)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <View testID="employee-details-loading" style={{ padding: 24 }}>
        <Text variant="body.m" color={theme.content.dark}>
          Carregando…
        </Text>
      </View>
    )
  }
  if (!employee) {
    return (
      <View testID="employee-details-empty" style={{ padding: 24, gap: theme.gap.s }}>
        <Title variant="title.s" color={theme.content.dark}>
          Funcionário não encontrado
        </Title>
      </View>
    )
  }

  // Vitais e medições decidem com as mesmas opções, e as legendas de horário
  // seguem o relógio da página.
  const readingOptions: ReadingOptions = {
    failed: failed || deviceState === 'failed',
    noDevice: deviceState === 'unpaired',
    deviceUnknown: deviceState !== 'paired',
    now,
  }

  return (
    <WorkerDetailsLayout
      worker={{
        ...employee,
        // O gráfico de gasto calórico lê a série deste funcionário.
        seriesWorkerId: employee.id,
        vitals: vitalsViewFrom(telemetry, readingOptions),
        measurements: measurementsViewFrom(telemetry, readingOptions),
      }}
      position={position ? { lat: position.lat, lng: position.lng } : null}
      positionNote={position ? stalePositionNote(position.recordedAt, now) : null}
      testID="employee-details"
      onBack={() => navigate('/employees')}
      backA11yLabel="Voltar para a lista de funcionários"
      onOpenFullMap={() => navigate(fullMapPath(employee.id))}
      deviceSection={
        <DeviceSection
          workerId={employee.id}
          telemetry={telemetry}
          onDeviceStateChange={setDeviceState}
        />
      }
      topRightAction={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          {/* Faixas aprendidas, travas e histórico da calibração individual.
              Sem calibração (DEMO ou ainda sem dias) não há o que abrir. */}
          {telemetry?.calibration ? (
            <Button
              label="Faixas e travas"
              variant="outline"
              accessibilityLabel="Faixas e travas"
              onPress={() => navigate(`/employees/${employee.id}/faixas`)}
            />
          ) : null}
          <Button
            label={pausing ? 'Solicitando…' : 'Solicitar Pausa'}
            variant="contained"
            backgroundColor={theme.surface.accent}
            accessibilityLabel="Solicitar pausa para o funcionário"
            disabled={pausing}
            onPress={() => requestPause(employee)}
          />
        </View>
      }
    />
  )
}
