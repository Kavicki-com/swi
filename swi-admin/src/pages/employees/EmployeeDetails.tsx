// src/pages/employees/EmployeeDetails.tsx
// Employee details. Three-column worker layout shared with
// AdminDetails via `WorkerDetailsLayout`. This page owns employee data
// fetching and supplies the top-right "Solicitar Pausa" CTA (contained
// button in surface.accent, the employee-specific variant of the slot).
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { employeesApi, type Employee } from '@/services/api/users'
import { notificationsApi } from '@/services/api/notifications'
import { WorkerDetailsLayout } from '@/pages/_shared/WorkerDetailsLayout'
import { DeviceSection } from '@/pages/employees/DeviceSection'
import { vitalsViewFrom } from '@/services/vitals/vitalsView'
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
  // Quem sabe se há aparelho é o bloco Aparelho; sem ele os vitais dizem
  // "Sem aparelho". null enquanto o bloco não sabe.
  const [paired, setPaired] = useState<boolean | null>(null)

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

  return (
    <WorkerDetailsLayout
      worker={{
        ...employee,
        // O gráfico de gasto calórico lê a série deste funcionário.
        seriesWorkerId: employee.id,
        vitals: vitalsViewFrom(telemetry, { failed, noDevice: paired === false }),
      }}
      position={position ? { lat: position.lat, lng: position.lng } : null}
      positionNote={position ? stalePositionNote(position.recordedAt, now) : null}
      testID="employee-details"
      onBack={() => navigate('/employees')}
      backA11yLabel="Voltar para a lista de funcionários"
      onOpenFullMap={() => navigate('/maps/general')}
      deviceSection={
        <DeviceSection workerId={employee.id} telemetry={telemetry} onPairedChange={setPaired} />
      }
      topRightAction={
        <Button
          label={pausing ? 'Solicitando…' : 'Solicitar Pausa'}
          variant="contained"
          backgroundColor={theme.surface.accent}
          accessibilityLabel="Solicitar pausa para o funcionário"
          disabled={pausing}
          onPress={() => requestPause(employee)}
        />
      }
    />
  )
}
