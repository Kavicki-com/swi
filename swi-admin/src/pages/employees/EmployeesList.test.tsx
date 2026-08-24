// Smoke + behaviour tests. The smoke test guards mount regressions (DS bumps,
// route refactors, import-graph changes); the "Pendentes" tab tests cover the
// approval queue (list + aprovar + rejeitar com confirmação + rollback de erro).
// Interactions use fireEvent (Testing Library) — @testing-library/user-event is
// not a direct dependency of this app, so we follow the project convention.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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

  it('renders without crashing', async () => {
    await expect(renderPage(<EmployeesList />, { route: '/employees' })).resolves.toBeDefined()
  })

  // O ícone de chat precisa dizer QUEM. Mandar pra /chat sem destino faz o
  // inbox abrir a conversa mais recente, a mesma pessoa em qualquer clique. O
  // destino certo é a conversa determinística com o clicado.
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
      active: true,
    }
    vi.spyOn(employeesApi, 'list').mockResolvedValue({ data: [ALLAN], error: null })
    await renderPage(<EmployeesList />, { route: '/employees' })
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
    await renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => expect(screen.getByText('Novo Worker')).toBeTruthy())
    expect(screen.getByText('novo@x.com')).toBeTruthy()
  })

  // O admin decide aprovar em cima destes campos. Uma fila com só nome e
  // e-mail faz a aprovação acontecer às cegas.
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
    await renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => expect(screen.getByTestId('pending-doc-p1')).toBeTruthy())
    expect(screen.getByTestId('pending-doc-p1')).toHaveTextContent('CPF 000.000.000-00')
    expect(screen.getByTestId('pending-doc-p1')).toHaveTextContent('(41) 90000-0000')
    expect(screen.getByTestId('pending-health-p1')).toHaveTextContent('Sangue O-')
    expect(screen.getByTestId('pending-health-p1')).toHaveTextContent('Curitiba/PR')
  })

  it('cadastro sem perfil diz o que falta em vez de fingir que carregou', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({ data: [NOVO], error: null })
    await renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => expect(screen.getByTestId('pending-doc-p1')).toBeTruthy())
    expect(screen.getByTestId('pending-doc-p1')).toHaveTextContent('não informado')
    expect(screen.getByTestId('pending-health-p1')).toHaveTextContent('não informado')
  })

  it('aprovar remove o pendente da lista', async () => {
    vi.spyOn(approvalsApi, 'listPendingWorkers').mockResolvedValue({ data: [NOVO], error: null })
    const approve = vi
      .spyOn(approvalsApi, 'approve')
      .mockResolvedValue({ data: { id: 'p1', approvalStatus: 'APPROVED' }, error: null })
    await renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
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
    await renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
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
    await renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
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
    await renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
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
    await renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
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
    await renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
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
    await renderPage(<EmployeesList initialTab="pendentes" />, { route: '/employees' })
    await waitFor(() => screen.getByText('Novo Worker'))

    fireEvent.click(screen.getByRole('button', { name: /rejeitar novo worker/i }))
    expect(screen.getByText('Rejeitar cadastro?')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Fechar'))

    await waitFor(() => expect(screen.queryByText('Rejeitar cadastro?')).toBeNull())
    expect(reject).not.toHaveBeenCalled()
  })
})

// O backend expõe DELETE /users/:id desde o fechamento dos CRUDs, e a lista de
// ADMINS já o consome com confirmação, exclusão otimista e rollback. A lista de
// FUNCIONÁRIOS tinha o mesmo cluster de ícones na linha e nenhum caminho pra
// excluir: a rota existia e ninguém a alcançava. Isto espelha o fluxo provado.
describe('EmployeesList: excluir funcionário', () => {
  afterEach(() => {
    clearSession()
    vi.restoreAllMocks()
  })

  const ZE: Employee = {
    id: 'w1',
    name: 'Zé da Silva',
    age: 30,
    bloodType: 'O+',
    role: 'Operador',
    specialization: 'Elétrica',
    avatarUri: '',
    sector: 'Manutenção',
    vitalsStatus: 'good',
    active: true,
  }

  it('confirmar dispara o DELETE e a linha some; cancelar mantém', async () => {
    vi.spyOn(employeesApi, 'list').mockResolvedValue({ data: [ZE], error: null })
    const remove = vi.spyOn(employeesApi, 'remove').mockResolvedValue({ data: null, error: null })
    await renderPage(<EmployeesList />, { route: '/employees' })
    await waitFor(() => screen.getByText('Zé da Silva'))

    fireEvent.click(screen.getByRole('button', { name: /excluir zé da silva/i }))
    expect(screen.getByText('Excluir funcionário?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByText('Zé da Silva')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /excluir zé da silva/i }))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
    expect(remove).toHaveBeenCalledWith('w1')
    await waitFor(() => expect(screen.queryByText('Zé da Silva')).toBeNull())
  })

  // O 409 de registros vinculados é o caso REAL aqui: funcionário acumula
  // jornada, tarefa e relatório, então recusar é o normal, não a exceção. A
  // linha tem que voltar pra posição original, senão a lista se reordena
  // sozinha na cara de quem só tentou excluir.
  it('recusa do backend reinsere a linha na posição original', async () => {
    const ALFA: Employee = { ...ZE, id: 'w-alfa', name: 'Alfa Operário' }
    const BRAVO: Employee = { ...ZE, id: 'w-bravo', name: 'Bravo Operário' }
    vi.spyOn(employeesApi, 'list').mockResolvedValue({ data: [ALFA, BRAVO], error: null })
    vi.spyOn(employeesApi, 'remove').mockResolvedValue({
      data: null,
      error: { message: 'Usuário possui registros vinculados; desative-o em vez de excluir' },
    })
    await renderPage(<EmployeesList />, { route: '/employees' })
    await waitFor(() => screen.getByText('Alfa Operário'))

    fireEvent.click(screen.getByRole('button', { name: /excluir alfa operário/i }))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))

    await waitFor(() => expect(screen.getByText('Alfa Operário')).toBeTruthy())
    const alfa = screen.getByText('Alfa Operário')
    const bravo = screen.getByText('Bravo Operário')
    expect(alfa.compareDocumentPosition(bravo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // Voltar do formulário de cadastro redispara o list(). Essa resposta é montada
  // no servidor ANTES do DELETE, então chegar depois dele não desmente a
  // exclusão: aplicá-la crua ressuscitava a linha recém-excluída, e só um F5 a
  // tirava da tela de novo.
  it('lista em voo que chega depois do DELETE não ressuscita a linha', async () => {
    let entregarRefetch: (r: { data: Employee[]; error: null }) => void = () => {}
    vi.spyOn(employeesApi, 'list')
      .mockResolvedValueOnce({ data: [ZE], error: null })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            entregarRefetch = resolve
          }),
      )
    vi.spyOn(employeesApi, 'remove').mockResolvedValue({ data: null, error: null })

    await renderPage(<EmployeesList initialTab="cadastrar" />, { route: '/employees' })
    fireEvent.click(screen.getByRole('button', { name: /voltar para a lista de funcionários/i }))
    await waitFor(() => screen.getByText('Zé da Silva'))

    fireEvent.click(screen.getByRole('button', { name: /excluir zé da silva/i }))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
    await waitFor(() => expect(screen.queryByText('Zé da Silva')).toBeNull())

    await act(async () => entregarRefetch({ data: [ZE], error: null }))

    expect(screen.queryByText('Zé da Silva')).toBeNull()
  })

  // Duas exclusões em voo, as duas recusadas: no funcionário isso não é caso de
  // canto, é o normal (quem trabalhou tem jornada e relatório vinculados). A
  // posição guardada como ÍNDICE envelhece durante o await, e a segunda linha
  // voltava trocada de lugar com a primeira.
  it('duas recusas em voo devolvem cada linha ao seu lugar', async () => {
    const ALFA: Employee = { ...ZE, id: 'w-alfa', name: 'Alfa Operário' }
    const BRAVO: Employee = { ...ZE, id: 'w-bravo', name: 'Bravo Operário' }
    const CARLOS: Employee = { ...ZE, id: 'w-carlos', name: 'Carlos Operário' }
    vi.spyOn(employeesApi, 'list').mockResolvedValue({ data: [ALFA, BRAVO, CARLOS], error: null })
    const recusas: Record<string, () => void> = {}
    vi.spyOn(employeesApi, 'remove').mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          recusas[id] = () =>
            resolve({ data: null, error: { message: 'possui registros vinculados' } })
        }),
    )
    await renderPage(<EmployeesList />, { route: '/employees' })
    await waitFor(() => screen.getByText('Alfa Operário'))

    fireEvent.click(screen.getByRole('button', { name: /excluir alfa operário/i }))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
    fireEvent.click(screen.getByRole('button', { name: /excluir carlos operário/i }))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
    await waitFor(() => expect(screen.queryByText('Carlos Operário')).toBeNull())

    // Estourar é melhor que passar: sem a recusa registrada o teste não
    // exercitaria rollback nenhum e ficaria verde à toa.
    const recusar = (id: string) => {
      const recusa = recusas[id]
      if (!recusa) throw new Error(`remove(${id}) não chegou a ser chamado`)
      return act(async () => recusa())
    }
    await recusar('w-alfa')
    await recusar('w-carlos')

    const nomes = screen
      .getAllByText(/ Operário$/)
      .map((n) => n.textContent)
      .filter((n): n is string => !!n)
    expect(nomes).toEqual(['Alfa Operário', 'Bravo Operário', 'Carlos Operário'])
  })

  // A linha pode sumir da lista entre abrir a confirmação e o backend responder
  // (outro admin excluiu primeiro, e o refetch já a tirou da tela). Reinserir
  // depois disso pintava uma linha fantasma no fim: alguém que o servidor não
  // lista mais.
  it('recusa de linha que já saiu da lista não pinta linha fantasma', async () => {
    const ALFA: Employee = { ...ZE, id: 'w-alfa', name: 'Alfa Operário' }
    const BRAVO: Employee = { ...ZE, id: 'w-bravo', name: 'Bravo Operário' }
    let entregarRefetch: (r: { data: Employee[]; error: null }) => void = () => {}
    vi.spyOn(employeesApi, 'list')
      .mockResolvedValueOnce({ data: [ALFA, BRAVO], error: null })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            entregarRefetch = resolve
          }),
      )
    vi.spyOn(employeesApi, 'remove').mockResolvedValue({
      data: null,
      error: { message: 'Usuário não encontrado' },
    })

    await renderPage(<EmployeesList initialTab="cadastrar" />, { route: '/employees' })
    fireEvent.click(screen.getByRole('button', { name: /voltar para a lista de funcionários/i }))
    await waitFor(() => screen.getByText('Alfa Operário'))

    fireEvent.click(screen.getByRole('button', { name: /excluir alfa operário/i }))
    // O refetch chega com a lista SEM o Alfa, com a confirmação ainda aberta.
    await act(async () => entregarRefetch({ data: [BRAVO], error: null }))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))

    await waitFor(() => expect(screen.getByText('Bravo Operário')).toBeTruthy())
    expect(screen.queryByText('Alfa Operário')).toBeNull()
  })
})

// Ativar/desativar funcionário. O 409 do DELETE responde "desative-o em vez de
// excluir", uma remediação que a lista não oferecia: o controle existia só na
// lista de admins, sobre a MESMA rota. Estes casos espelham os da AdminsList
// de propósito, porque duas listas irmãs que se comportam diferente sobre a
// mesma ação fazem o operador errar o alvo.
describe('EmployeesList: ativar e desativar', () => {
  const CARLOS: Employee = {
    id: 'w1',
    name: 'Carlos Mendes',
    age: 34,
    bloodType: 'O+',
    role: 'Soldador',
    specialization: 'Estruturas metálicas',
    avatarUri: '',
    sector: 'Estruturas metálicas',
    vitalsStatus: 'good',
    active: true,
  }

  afterEach(() => {
    clearSession()
    vi.restoreAllMocks()
  })

  it('alternar o switch chama employeesApi.setActive(id, novoValor)', async () => {
    vi.spyOn(employeesApi, 'list').mockResolvedValue({ data: [CARLOS], error: null })
    const setActive = vi
      .spyOn(employeesApi, 'setActive')
      .mockResolvedValue({ data: { id: 'w1', active: false }, error: null })
    await renderPage(<EmployeesList />, { route: '/employees' })
    await waitFor(() => screen.getByText('Carlos Mendes'))

    // Estava ativo, então o toggle manda desativar.
    fireEvent.click(screen.getByRole('switch', { name: /ativar carlos mendes/i }))

    expect(setActive).toHaveBeenCalledWith('w1', false)
  })

  it('toggle com erro reverte o switch ao valor original', async () => {
    vi.spyOn(employeesApi, 'list').mockResolvedValue({ data: [CARLOS], error: null })
    vi.spyOn(employeesApi, 'setActive').mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    await renderPage(<EmployeesList />, { route: '/employees' })
    await waitFor(() => screen.getByText('Carlos Mendes'))

    // Esta versão do react-native-web não emite aria-checked: o estado on/off do
    // Toggle vira a classe atômica de justify-content (thumb à direita/esquerda).
    // É o mesmo sinal público que o teste irmão da AdminsList usa.
    const sw = screen.getByRole('switch', { name: /ativar carlos mendes/i })
    const classeAtiva = sw.className

    fireEvent.click(sw)
    expect(sw.className).not.toBe(classeAtiva)

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /ativar carlos mendes/i }).className).toBe(
        classeAtiva,
      ),
    )
  })

  // O funcionário que chega desativado do backend precisa ABRIR desligado: um
  // switch que sempre nasce ligado mente sobre quem está sem acesso e faz o
  // admin desligar de novo quem já estava desligado.
  it('funcionário inativo abre com o switch desligado', async () => {
    vi.spyOn(employeesApi, 'list').mockResolvedValue({
      data: [{ ...CARLOS, active: false }],
      error: null,
    })
    const setActive = vi
      .spyOn(employeesApi, 'setActive')
      .mockResolvedValue({ data: { id: 'w1', active: true }, error: null })
    await renderPage(<EmployeesList />, { route: '/employees' })
    await waitFor(() => screen.getByText('Carlos Mendes'))

    // Estava inativo, então o primeiro clique só pode significar ATIVAR.
    fireEvent.click(screen.getByRole('switch', { name: /ativar carlos mendes/i }))

    expect(setActive).toHaveBeenCalledWith('w1', true)
  })
})
