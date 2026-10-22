// Detalhe de relatório que não chega (id inexistente ou falha de rede): a tela
// sai do "Carregando…" e diz o que houve, com Voltar e Tentar novamente, no
// mesmo formato do detalhe da tarefa.
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { ReportDetails } from './ReportDetails'

const h = vi.hoisted(() => ({ get: vi.fn(), nav: vi.fn() }))
vi.mock('@/services/api/reports', () => ({
  reportsApi: { get: h.get, addComment: vi.fn(), remove: vi.fn() },
}))
vi.mock('@/lib/demoToast', () => ({
  useDemoToast: () => ({ show: vi.fn() }),
  DemoToastProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => h.nav }
})

const renderAt = () =>
  renderPage(<ReportDetails />, { route: '/reports/nao-existe', path: '/reports/:id' })

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('ReportDetails: relatório que não chega', () => {
  it('id inexistente mostra o erro do servidor em vez de carregar para sempre', async () => {
    h.get.mockResolvedValue({ data: null, error: { message: 'Relatório não encontrado' } })
    await renderAt()

    expect(screen.queryByTestId('report-details-loading')).toBeNull()
    expect(screen.getByTestId('report-details-error').textContent).toBe('Relatório não encontrado')
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para a lista de relatórios' }))
    expect(h.nav).toHaveBeenCalledWith('/reports')
  })

  it('Tentar novamente busca de novo', async () => {
    h.get.mockResolvedValue({ data: null, error: { message: 'Falha ao carregar' } })
    await renderAt()
    expect(h.get).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await act(async () => {})

    expect(h.get).toHaveBeenCalledTimes(2)
  })
})
