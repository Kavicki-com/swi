// Smoke + behaviour tests. The smoke test guards mount regressions (DS bumps,
// route refactors, import-graph changes); the "Pendentes" tab tests cover the
// approval queue (list + aprovar + rejeitar com confirmação + rollback de erro).
// Interactions use fireEvent (Testing Library) — @testing-library/user-event is
// not a direct dependency of this app, so we follow the project convention.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { approvalsApi, employeesApi, type Employee, type PendingUser } from '@/services/api/users'
import { EmployeesList } from './EmployeesList'
import { clearSession, renderPage } from '@/test-utils/renderPage'

// Espião de navegação (padrão do ChatInbox.test.tsx): o MemoryRouter fica, só o
// useNavigate é observado.
const nav = vi.hoisted(() => ({ spy: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => nav.spy }
})

// Cadastro sem perfil: o app antigo não mandava nada junto, e a fila precisa
// seguir renderizando (dizendo o que falta) em vez de quebrar.
const SEM_PERFIL = {
  cpf: null,
  phone: null,
  birthDate: null,
  city: null,
  uf: null,
  bloodType: null,
  allergies: null,
  avatar: '',
} as const

const NOVO: PendingUser = {
  id: 'p1',
  name: 'Novo Worker',
  email: 'novo@x.com',
  requestedAt: '2026-07-10T00:00:00.000Z',
  ...SEM_PERFIL,
}

describe('EmployeesList', () => {
  afterEach(() => {
    clearSession()
    vi.restoreAllMocks()
  })

  it('renders without crashing', () => {
    expect(() => renderPage(<EmployeesList />, { route: '/employees' })).not.toThrow()
  })

  // QA Web #10: o ícone de chat mandava pra /chat sem dizer QUEM, e o inbox
  // fixava a conversa mais recente — clicasse em quem clicasse, abria sempre a
  // mesma pessoa. O destino certo é a conversa determinística com o clicado.
  it('ícone de chat abre a conversa do funcionário clicado, não /chat solto', async () => {
    const ALLAN: Employee = {
      id: 'w9',
      name: 'Allan Souza',
      age: 30,
      bloodType: 'A+',
      role: 'Operador',
      specialization: 'Setor Leste',
      avatarUri: '',
      sector: 'Setor Leste',
      vitalsStatus: 'good',
    }
    vi.spyOn(employeesApi, 'list').mockResolvedValue({ data: [ALLAN], error: null })
    renderPage(<EmployeesList />, { route: '/employees' })
    await waitFor(() => screen.getByText('Allan Souza'))

    fireEvent.click(screen.getByRole('button', { name: /conversar com allan souza/i }))

    // Sessão semeada: u_seed_1 (renderPage). Key ordenada + '#' encodado.
    expect(nav.spy).toHaveBeenCalledWith('/chat/u_seed_1%23w9')
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

  // O admin decide aprovar em cima destes campos — a fila mostrava só nome e
  // e-mail e ele aprovava às cegas (QA 2026-07-26).
  it('mostra CPF, telefone, tipo sanguíneo e cidade do cadastro', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({
      data: [
        {
          ...NOVO,
          cpf: '000.000.000-00',
          phone: '(41) 90000-0000',
          bloodType: 'O-',
          city: 'Curitiba',
          uf: 'PR',
        },
      ],
      error: null,
    })
    renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => expect(screen.getByTestId('pending-doc-p1')).toBeTruthy())
    expect(screen.getByTestId('pending-doc-p1')).toHaveTextContent('CPF 000.000.000-00')
    expect(screen.getByTestId('pending-doc-p1')).toHaveTextContent('(41) 90000-0000')
    expect(screen.getByTestId('pending-health-p1')).toHaveTextContent('Sangue O-')
    expect(screen.getByTestId('pending-health-p1')).toHaveTextContent('Curitiba/PR')
  })

  it('cadastro sem perfil diz o que falta em vez de fingir que carregou', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({ data: [NOVO], error: null })
    renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => expect(screen.getByTestId('pending-doc-p1')).toBeTruthy())
    expect(screen.getByTestId('pending-doc-p1')).toHaveTextContent('não informado')
    expect(screen.getByTestId('pending-health-p1')).toHaveTextContent('não informado')
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

  it('approve com erro faz a linha reaparecer (rollback)', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({ data: [NOVO], error: null })
    vi.spyOn(approvalsApi, 'approve').mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => screen.getByText('Novo Worker'))

    fireEvent.click(screen.getByRole('button', { name: /aprovar novo worker/i }))

    // Removido de forma otimista, mas volta quando o backend responde erro.
    await waitFor(() => expect(screen.getByText('Novo Worker')).toBeTruthy())
  })

  it('reject com erro faz a linha reaparecer (rollback)', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({ data: [NOVO], error: null })
    vi.spyOn(approvalsApi, 'reject').mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => screen.getByText('Novo Worker'))

    fireEvent.click(screen.getByRole('button', { name: /rejeitar novo worker/i }))
    fireEvent.click(screen.getByRole('button', { name: /^rejeitar$/i }))

    await waitFor(() => expect(screen.getByText('Novo Worker')).toBeTruthy())
  })

  it('rollback reinsere na posição original, não no fim da lista', async () => {
    const ALFA: PendingUser = {
      id: 'a',
      name: 'Alfa',
      email: 'a@x.com',
      requestedAt: NOVO.requestedAt,
      ...SEM_PERFIL,
    }
    const BRAVO: PendingUser = {
      id: 'b',
      name: 'Bravo',
      email: 'b@x.com',
      requestedAt: NOVO.requestedAt,
      ...SEM_PERFIL,
    }
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({
      data: [ALFA, BRAVO],
      error: null,
    })
    vi.spyOn(approvalsApi, 'approve').mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => screen.getByText('Alfa'))

    fireEvent.click(screen.getByRole('button', { name: /aprovar alfa/i }))
    await waitFor(() => expect(screen.getByText('Alfa')).toBeTruthy())

    // Alfa (índice 0) tem que voltar ANTES de Bravo, não jogado pro fim.
    const alfa = screen.getByText('Alfa')
    const bravo = screen.getByText('Bravo')
    expect(alfa.compareDocumentPosition(bravo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Escape fecha o ConfirmReject sem rejeitar', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({ data: [NOVO], error: null })
    const reject = vi
      .spyOn(approvalsApi, 'reject')
      .mockResolvedValue({ data: { id: 'p1', approvalStatus: 'REJECTED' }, error: null })
    renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => screen.getByText('Novo Worker'))

    fireEvent.click(screen.getByRole('button', { name: /rejeitar novo worker/i }))
    expect(screen.getByText('Rejeitar cadastro?')).toBeTruthy()

    fireEvent.keyDown(document.body, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByText('Rejeitar cadastro?')).toBeNull())
    expect(reject).not.toHaveBeenCalled()
    expect(screen.getByText('Novo Worker')).toBeTruthy()
  })

  it('clicar no scrim fecha o ConfirmReject sem rejeitar', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({ data: [NOVO], error: null })
    const reject = vi
      .spyOn(approvalsApi, 'reject')
      .mockResolvedValue({ data: { id: 'p1', approvalStatus: 'REJECTED' }, error: null })
    renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => screen.getByText('Novo Worker'))

    fireEvent.click(screen.getByRole('button', { name: /rejeitar novo worker/i }))
    expect(screen.getByText('Rejeitar cadastro?')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Fechar'))

    await waitFor(() => expect(screen.queryByText('Rejeitar cadastro?')).toBeNull())
    expect(reject).not.toHaveBeenCalled()
  })
})
