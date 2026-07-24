// Tela /tasks — lista de tarefas (work orders). describe/it/expect/beforeEach
// vêm dos globals do Vitest.
//
// O client de work orders é mockado inteiro: o contrato dele já é coberto em
// services/api/workOrders.test.ts; aqui o que interessa é o comportamento da
// tela (aba → status, busca client-side, estados, navegação, corrida de abas).
import { vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { ApiError } from '@/services/api/http'
import type { WorkOrderRow, WorkOrderStatus } from '@/services/api/workOrders'
import { seedSession, clearSession } from '@/test-utils/renderPage'
import { TasksList } from './TasksList'

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }))
vi.mock('@/services/api/workOrders', () => ({
  workOrdersApi: {
    list: listMock,
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    assignable: vi.fn(),
  },
}))

// responsibleAvatars é index-parallel com responsibleCount (ver comentário do
// contrato): 18 responsáveis = 18 posições, mesmo que algumas venham ''.
const avatars = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.test/${i}.png`)

const REPARO: WorkOrderRow = {
  id: 'wo_1',
  title: 'Reparo',
  sector: 'Setor Leste',
  status: 'in_progress',
  progressPct: 84,
  responsibleCount: 18,
  responsibleAvatars: avatars(18),
}

const INSPECAO: WorkOrderRow = {
  id: 'wo_2',
  title: 'Inspeção',
  sector: 'Setor Norte',
  status: 'in_progress',
  progressPct: 42,
  responsibleCount: 3,
  responsibleAvatars: avatars(3),
}

// Mesmo título de REPARO, setor diferente — o backend não impede tarefas
// homônimas em setores distintos.
const REPARO_NORTE: WorkOrderRow = {
  id: 'wo_3',
  title: 'Reparo',
  sector: 'Setor Norte',
  status: 'in_progress',
  progressPct: 10,
  responsibleCount: 2,
  responsibleAvatars: avatars(2),
}

const CONCLUIDA: WorkOrderRow = {
  id: 'wo_9',
  title: 'Troca de filtro',
  sector: 'Setor Sul',
  status: 'done',
  progressPct: 100,
  responsibleCount: 1,
  responsibleAvatars: avatars(1),
}

// Promise controlada pelo teste — usada pra forçar ordens de resolução que o
// runtime real produziria só sob latência variável.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Sonda de rota: expõe o :id capturado pra provar PRA QUAL tarefa a linha
// navegou, não só que saiu da lista.
function TaskDetailsProbe() {
  const { id } = useParams<{ id: string }>()
  return <div data-testid="task-details-route">{id}</div>
}

function renderAt(route = '/tasks') {
  seedSession()
  return render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/tasks" element={<TasksList />} />
            <Route path="/tasks/new" element={<div data-testid="task-form-route" />} />
            <Route path="/tasks/:id" element={<TaskDetailsProbe />} />
            <Route path="/maps/general" element={<div data-testid="maps-route" />} />
            <Route path="/" element={<div data-testid="dashboard-route" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )
}

beforeEach(() => {
  listMock.mockReset()
  listMock.mockResolvedValue([REPARO, INSPECAO])
})

afterEach(clearSession)

describe('TasksList — Voltar', () => {
  // Era navigate(-1), que sai da SPA quando não há entrada anterior no
  // histórico: entrando por deep-link em /tasks deslogado, RequireAuth e Login
  // redirecionam os dois com `replace`, então a pilha pode começar aqui.
  it('vai pro dashboard em vez de andar no histórico', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))

    await waitFor(() => expect(screen.getByTestId('dashboard-route')).toBeInTheDocument())
  })

  // O caso que o navigate(-1) quebrava: /tasks é a ÚNICA entrada do histórico.
  it('vai pro dashboard mesmo sendo a primeira entrada do histórico', async () => {
    renderAt('/tasks')
    await waitFor(() => expect(screen.getByText('Reparo')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))

    await waitFor(() => expect(screen.getByTestId('dashboard-route')).toBeInTheDocument())
    expect(screen.queryByTestId('tasks-list')).not.toBeInTheDocument()
  })
})

describe('TasksList', () => {
  it('busca a aba inicial (in_progress) ao montar e renderiza a tarefa', async () => {
    renderAt()
    await waitFor(() => {
      expect(screen.getByText('Reparo')).toBeInTheDocument()
    })
    expect(listMock).toHaveBeenCalledWith('in_progress')
  })

  // DS 0.1.118: locationAccessibilityLabel — o pino saía com 'Open location'
  // fixo em inglês; a lista passa o label pt-BR por tarefa.
  it('o pino de localização tem label pt-BR com o título da tarefa', async () => {
    renderAt()
    await waitFor(() => {
      expect(screen.getByText('Inspeção')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Abrir localização da tarefa Inspeção')).toBeInTheDocument()
    expect(screen.queryByLabelText('Open location')).not.toBeInTheDocument()
  })

  it('trocar pra "Concluídas" refaz a busca com done', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: 'Concluídas' }))

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith('done')
    })
  })

  it('a aba "A Fazer" busca pending', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: 'A Fazer' }))

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith('pending')
    })
  })

  it('a busca filtra por título no cliente, sem nova chamada ao backend', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo')).toBeInTheDocument())
    expect(listMock).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByPlaceholderText('Pesquisar tarefa'), {
      target: { value: 'repa' },
    })

    await waitFor(() => {
      expect(screen.queryByText('Inspeção')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Reparo')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('a busca também filtra por setor', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('Pesquisar tarefa'), {
      target: { value: 'norte' },
    })

    await waitFor(() => {
      expect(screen.queryByText('Reparo')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Inspeção')).toBeInTheDocument()
  })

  it('mostra o estado vazio quando a aba não tem tarefas', async () => {
    listMock.mockResolvedValue([])
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('tasks-empty')).toHaveTextContent(/nenhuma tarefa/i)
    })
  })

  it('mostra a mensagem do ApiError quando a busca falha', async () => {
    listMock.mockRejectedValue(new ApiError('Não foi possível conectar ao servidor', 0))
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('tasks-error')).toHaveTextContent(
        'Não foi possível conectar ao servidor',
      )
    })
  })

  it('"Tentar novamente" refaz a busca da aba atual depois de um erro', async () => {
    listMock.mockRejectedValueOnce(new ApiError('Erro 500', 500))
    listMock.mockResolvedValueOnce([REPARO, INSPECAO])
    renderAt()
    await waitFor(() => expect(screen.getByTestId('tasks-error')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    await waitFor(() => {
      expect(screen.getByText('Reparo')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('tasks-error')).not.toBeInTheDocument()
    expect(listMock).toHaveBeenNthCalledWith(2, 'in_progress')
  })

  it('mostra o estado de carregando enquanto a busca não resolve', () => {
    listMock.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(screen.getByTestId('tasks-loading')).toBeInTheDocument()
  })

  it('clicar na linha navega pro detalhe /tasks/:id', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Reparo, Setor Leste' }))

    await waitFor(() => {
      expect(screen.getByTestId('task-details-route')).toHaveTextContent('wo_1')
    })
  })

  it('distingue duas tarefas de mesmo título por setor no nome acessível', async () => {
    listMock.mockResolvedValue([REPARO, REPARO_NORTE])
    renderAt()
    await waitFor(() => expect(screen.getAllByText('Reparo')).toHaveLength(2))

    expect(screen.getByRole('button', { name: 'Reparo, Setor Leste' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reparo, Setor Norte' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reparo, Setor Norte' }))

    await waitFor(() => {
      expect(screen.getByTestId('task-details-route')).toHaveTextContent('wo_3')
    })
  })

  it('"Nova Tarefa" navega pro formulário', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Nova Tarefa' }))

    await waitFor(() => {
      expect(screen.getByTestId('task-form-route')).toBeInTheDocument()
    })
  })

  it('o pino navega pro mapa e NÃO dispara a navegação da linha', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo')).toBeInTheDocument())

    // Pressables aninhados: o pino vive dentro do card clicável. Só o interno
    // pode vencer — se o clique vazar pro card, a rota final vira /tasks/wo_1.
    const pins = screen.getAllByRole('button', { name: /Abrir localização da tarefa/ })
    const firstPin = pins.at(0)
    expect(firstPin).toBeDefined()
    fireEvent.click(firstPin as HTMLElement)

    await waitFor(() => {
      expect(screen.getByTestId('maps-route')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('task-details-route')).not.toBeInTheDocument()
  })

  it('o cluster de avatares mostra +N quando há mais responsáveis que avatares exibidos', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo')).toBeInTheDocument())
    // 18 responsáveis, 5 visíveis → +13.
    expect(screen.getByText('+13')).toBeInTheDocument()
  })

  it('respostas de abas fora de ordem não sobrescrevem a aba selecionada', async () => {
    const inProgress = deferred<WorkOrderRow[]>()
    const done = deferred<WorkOrderRow[]>()
    listMock.mockImplementation((status: WorkOrderStatus) =>
      status === 'done' ? done.promise : inProgress.promise,
    )

    renderAt()
    // Troca de aba com a busca de in_progress ainda pendente.
    fireEvent.click(screen.getByRole('tab', { name: 'Concluídas' }))

    // A aba nova responde primeiro; a antiga chega DEPOIS (resposta atrasada).
    await act(async () => {
      done.resolve([CONCLUIDA])
    })
    await act(async () => {
      inProgress.resolve([REPARO, INSPECAO])
    })

    expect(screen.getByText('Troca de filtro')).toBeInTheDocument()
    expect(screen.queryByText('Reparo')).not.toBeInTheDocument()
    expect(screen.queryByText('Inspeção')).not.toBeInTheDocument()
  })
})
