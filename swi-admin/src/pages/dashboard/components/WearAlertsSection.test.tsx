// "Ver Todos" dos Alertas de Desgaste leva à tela que lista esses alertas: o
// monitoramento, aberto já sem o filtro de status (o mesmo "Ver Todos" de lá).
import { vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { WearAlertsSection } from './WearAlertsSection'
import type { WearRow } from '../dashboardHealth'

const nav = vi.hoisted(() => ({ spy: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => nav.spy }
})
const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => toast }))

const row: WearRow = {
  id: 'w1',
  employeeName: 'Ana Lima',
  sector: 'Setor Leste',
  bpm: 120,
  pressure: '12/8',
  tier: 'alerta-fadiga',
  demo: false,
  provisional: false,
  paired: true,
}

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('WearAlertsSection: Ver Todos', () => {
  it('abre o monitoramento sem filtro de status, sem toast', async () => {
    await renderPage(<WearAlertsSection rows={[row]} status="ready" />)

    fireEvent.click(screen.getByTestId('wear-alerts-see-all'))

    expect(nav.spy).toHaveBeenCalledWith('/monitoring/alerts?ver=todos')
    expect(toast.show).not.toHaveBeenCalled()
  })
})
