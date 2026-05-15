// src/pages/employees/EmployeeDetails.tsx
// Employee details — Figma 54:6561. Three-column worker layout shared with
// AdminDetails via `WorkerDetailsLayout`. This page owns employee data
// fetching and supplies the top-right "Solicitar Pausa" CTA (contained
// button in surface.accent, the employee-specific variant of the slot).
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { employeesApi, type Employee } from '@/services/mockApi/employees'
import { WorkerDetailsLayout } from '@/pages/_shared/WorkerDetailsLayout'
import { useDemoToast } from '@/lib/demoToast'

export function EmployeeDetails() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  const { id } = useParams<{ id: string }>()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)

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
      worker={employee}
      testID="employee-details"
      onBack={() => navigate('/employees')}
      backA11yLabel="Voltar para a lista de funcionários"
      onOpenFullMap={() => navigate('/maps/general')}
      topRightAction={
        <Button
          label="Solicitar Pausa"
          variant="contained"
          backgroundColor={theme.surface.accent}
          accessibilityLabel="Solicitar pausa para o funcionário"
          onPress={() =>
            showToast('Pausa solicitada', `${employee.name} foi notificado para pausar a atividade`)
          }
        />
      }
    />
  )
}
