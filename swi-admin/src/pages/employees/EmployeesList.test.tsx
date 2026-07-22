// Smoke + behaviour tests. The smoke test guards mount regressions (DS bumps,
// route refactors, import-graph changes); the "Pendentes" tab tests cover the
// approval queue (list + aprovar + rejeitar com confirmação).
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { approvalsApi, type PendingUser } from '@/services/api/users'
import { EmployeesList } from './EmployeesList'
import { clearSession, renderPage } from '@/test-utils/renderPage'

const NOVO: PendingUser = {
  id: 'p1',
  name: 'Novo Worker',
  email: 'novo@x.com',
  requestedAt: '2026-07-10T00:00:00.000Z',
}

describe('EmployeesList', () => {
  afterEach(() => {
    clearSession()
    vi.restoreAllMocks()
  })

  it('renders without crashing', () => {
    expect(() =>
      renderPage(<EmployeesList />, { route: '/employees' }),
    ).not.toThrow()
  })

  it('aba Pendentes lista os colaboradores PENDING', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({
      data: [NOVO],
      error: null,
    })
    renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => expect(screen.getByText('Novo Worker')).toBeTruthy())
    expect(screen.getByText('novo@x.com')).toBeTruthy()
  })

  it('aprovar remove o pendente da lista', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({ data: [NOVO], error: null })
    const approve = vi
      .spyOn(approvalsApi, 'approve')
      .mockResolvedValue({ data: { id: 'p1', approvalStatus: 'APPROVED' }, error: null })
    renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => screen.getByText('Novo Worker'))

    fireEvent.click(screen.getByRole('button', { name: /aprovar novo worker/i }))

    expect(approve).toHaveBeenCalledWith('p1')
    await waitFor(() => expect(screen.queryByText('Novo Worker')).toBeNull())
  })

  it('rejeitar só remove após confirmar; cancelar mantém', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({ data: [NOVO], error: null })
    const reject = vi
      .spyOn(approvalsApi, 'reject')
      .mockResolvedValue({ data: { id: 'p1', approvalStatus: 'REJECTED' }, error: null })
    renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => screen.getByText('Novo Worker'))

    // Abre a confirmação e cancela: nada é rejeitado, o item continua na lista.
    fireEvent.click(screen.getByRole('button', { name: /rejeitar novo worker/i }))
    expect(screen.getByText('Rejeitar cadastro?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(reject).not.toHaveBeenCalled()
    expect(screen.getByText('Novo Worker')).toBeTruthy()

    // Reabre e confirma: o botão "Rejeitar" da confirmação (nome exato, sem o
    // nome do worker) dispara a rejeição de fato.
    fireEvent.click(screen.getByRole('button', { name: /rejeitar novo worker/i }))
    fireEvent.click(screen.getByRole('button', { name: /^rejeitar$/i }))
    expect(reject).toHaveBeenCalledWith('p1')
    await waitFor(() => expect(screen.queryByText('Novo Worker')).toBeNull())
  })
})
