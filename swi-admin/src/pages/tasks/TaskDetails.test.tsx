// Tela /tasks/:id — detalhe da tarefa. describe/it/expect vêm dos globals do
// Vitest.
//
// O client de work orders é mockado inteiro: o contrato dele já é coberto em
// services/api/workOrders.test.ts. Aqui o que interessa é o comportamento da
// tela — tradução de status, marcação do checklist, formatação de datas,
// estados de carga/erro e navegação.
import { vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { ApiError } from '@/services/api/http'
import type {
  AssignableWorker,
  WorkOrderDetail,
  WorkOrderItem,
  WorkOrderStatus,
} from '@/services/api/workOrders'
import { seedSession, clearSession } from '@/test-utils/renderPage'
import { TaskDetails } from './TaskDetails'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))
vi.mock('@/services/api/workOrders', () => ({
  workOrdersApi: {
    list: vi.fn(),
    get: getMock,
    create: vi.fn(),
    update: vi.fn(),
    assignable: vi.fn(),
  },
}))

const ANA: AssignableWorker = {
  id: 'w_1',
  name: 'Ana Ribeiro',
  jobTitle: 'Técnica de manutenção',
  // Setor DIFERENTE do setor da tarefa de propósito: o card do responsável
  // também mostra um setor, e repetir 'Setor Leste' tornaria a asserção do
  // setor da TAREFA ambígua (casaria com o card também).
  sector: 'Setor Oeste',
  birthDate: '1990-02-10T00:00:00.000Z',
  avatar: 'https://cdn.test/ana.png',
}

const BRUNO: AssignableWorker = {
  id: 'w_2',
  name: 'Bruno Alves',
  jobTitle: 'Eletricista',
  sector: 'Setor Norte',
  birthDate: '1985-11-30T00:00:00.000Z',
  avatar: '',
}

// Sem birthDate: o backend permite null e a tela não pode inventar idade.
const CARLA: AssignableWorker = {
  id: 'w_3',
  name: 'Carla Dias',
  jobTitle: 'Supervisora',
  sector: 'Setor Sul',
  birthDate: null,
  avatar: 'https://cdn.test/carla.png',
}

// Os 4 estados do ITEM (superset do pai): só `done` pode aparecer marcado.
// `paused` e `in_progress` estão aqui de propósito — são os que um
// `!== 'pending'` ingênuo deixaria passar por concluídos.
const ITEMS: WorkOrderItem[] = [
  {
    id: 'it_1',
    title: 'Isolar o painel',
    description: 'Desligar a chave geral',
    status: 'done',
    startedAt: null,
    accumulatedSeconds: 0,
    estimatedMinutes: null,
  },
  {
    id: 'it_2',
    title: 'Trocar o rolamento',
    description: 'Modelo 6204',
    status: 'in_progress',
    startedAt: null,
    accumulatedSeconds: 0,
    estimatedMinutes: null,
  },
  {
    id: 'it_3',
    title: 'Lubrificar',
    description: 'Graxa azul',
    status: 'paused',
    startedAt: null,
    accumulatedSeconds: 0,
    estimatedMinutes: null,
  },
  {
    id: 'it_4',
    title: 'Testar a linha',
    description: 'Ciclo completo',
    status: 'pending',
    startedAt: null,
    accumulatedSeconds: 0,
    estimatedMinutes: null,
  },
]

// Base de item pros casos de tempo decorrido: um item só, sem estimativa
// própria (a da tarefa é que manda) e sem âncora de corrida — o tempo vem
// todo do acumulado, que é o que os testes controlam.
const ITEM_BASE: WorkOrderItem = {
  id: 'it_tempo',
  title: 'Item cronometrado',
  description: '',
  status: 'paused',
  startedAt: null,
  accumulatedSeconds: 0,
  estimatedMinutes: null,
}

function makeDetail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: 'wo_1',
    title: 'Reparo da esteira 3',
    summary: 'Esteira parada desde a madrugada.',
    details: 'Substituir o rolamento e reavaliar o alinhamento do eixo motor.',
    sector: 'Setor Leste',
    estimatedMinutes: 90,
    startDate: '2026-04-01T00:00:00.000Z',
    dueDate: '2026-05-20T00:00:00.000Z',
    createdAt: '2026-03-05T00:00:00.000Z',
    status: 'in_progress',
    progressPct: 42,
    author: { name: 'Marina Souza', avatar: 'https://cdn.test/marina.png' },
    responsibles: [ANA, BRUNO],
    items: ITEMS,
    images: ['https://s3.test/a.jpg?sig=1', 'https://s3.test/b.jpg?sig=2'],
    imageKeys: ['order/a.jpg', 'order/b.jpg'],
    ...overrides,
  }
}

/**
 * Um Radio do DS está PREENCHIDO?
 *
 * Olha o DOM porque não há alternativa: o Radio do DS passa
 * `accessibilityState={{ checked }}`, mas o react-native-web desta versão
 * DESCARTA a chave `checked` — o elemento sai com role/aria-label/tabindex e
 * nenhum `aria-checked`. Sem atributo pra consultar, o único sinal observável
 * do preenchimento é a estrutura que o DS renderiza: o anel (primeiro filho)
 * ganha um filho — a bolinha — só quando `checked`.
 *
 * Acoplado ao interior do DS de propósito e por falta de opção; se um bump
 * mudar essa estrutura, este helper quebra em um lugar só. Quando o DS/RNW
 * passar a emitir aria-checked, troque tudo isto por um toHaveAttribute.
 */
// O parâmetro é tipado estruturalmente (e não como `HTMLElement`) só pra não
// somar mais um `no-undef` de global do browser à lista que o eslint deste repo
// já acusa em vários testes — de quebra, deixa explícito que o helper toca
// exatamente dois campos do DOM.
function isFilled(radio: { firstElementChild: { childElementCount: number } | null }): boolean {
  const ring = radio.firstElementChild
  if (!ring) throw new Error('Radio do DS sem anel — a estrutura interna mudou.')
  return ring.childElementCount > 0
}

function renderAt(id = 'wo_1') {
  seedSession()
  return render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/tasks/${id}`]}>
          <Routes>
            <Route path="/tasks" element={<div data-testid="tasks-list-route" />} />
            <Route path="/tasks/:id" element={<TaskDetails />} />
            <Route path="/tasks/:id/edit" element={<div data-testid="task-edit-route" />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )
}

beforeEach(() => {
  getMock.mockReset()
  getMock.mockResolvedValue(makeDetail())
})

afterEach(clearSession)

describe('TaskDetails', () => {
  it('busca o detalhe do :id da rota', async () => {
    renderAt('wo_77')
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('wo_77'))
  })

  it('mostra título, autor e responsáveis', async () => {
    renderAt()
    await waitFor(() => {
      expect(screen.getByText('Reparo da esteira 3')).toBeInTheDocument()
    })
    expect(screen.getByText('Marina Souza')).toBeInTheDocument()
    // O nome aparece na linha-resumo do cartão E no card da seção Responsáveis.
    expect(screen.getAllByText('Ana Ribeiro').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bruno Alves').length).toBeGreaterThan(0)
  })

  it('mostra resumo, detalhes e setor', async () => {
    renderAt()
    await waitFor(() => {
      expect(screen.getByText('Esteira parada desde a madrugada.')).toBeInTheDocument()
    })
    expect(
      screen.getByText('Substituir o rolamento e reavaliar o alinhamento do eixo motor.'),
    ).toBeInTheDocument()
    // Copy corrigida: o Figma diz "relatório" por resíduo das telas de Relatórios.
    expect(screen.getByText('Detalhes da tarefa:')).toBeInTheDocument()
    expect(screen.getByText('Setor Leste')).toBeInTheDocument()
  })

  it.each<[WorkOrderStatus, string]>([
    ['pending', 'A fazer'],
    ['in_progress', 'Em andamento'],
    ['done', 'Concluída'],
  ])('traduz o status %s pro rótulo "%s"', async (status, label) => {
    getMock.mockResolvedValue(makeDetail({ status }))
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('task-details-status')).toHaveTextContent(label)
    })
  })

  it('marca no checklist só os itens concluídos', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByText('Isolar o painel')).toBeInTheDocument())

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)

    // Índice 0 = 'done'; 1..3 = in_progress, paused, pending. Só o primeiro
    // pode aparecer preenchido — os outros três são exatamente os que um
    // `status !== 'pending'` ingênuo marcaria por engano.
    expect(radios.map(isFilled)).toEqual([true, false, false, false])

    // O estado também precisa CHEGAR a quem usa leitor de tela. O react-native-web
    // descarta o `accessibilityState.checked` do Radio do DS (não emite
    // aria-checked nenhum — ver o comentário de isFilled), então o preenchimento
    // acima é puramente visual: sem o sufixo no nome acessível, a distinção
    // some pra quem não enxerga a bolinha.
    expect(screen.getByRole('radio', { name: 'Isolar o painel, concluído' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Trocar o rolamento' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Lubrificar' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Testar a linha' })).toBeInTheDocument()

    // A descrição de cada item também aparece.
    expect(screen.getByText('Modelo 6204')).toBeInTheDocument()
  })

  it('renderiza as imagens da tarefa', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByTestId('task-image-0')).toBeInTheDocument())
    expect(screen.getByTestId('task-image-1')).toBeInTheDocument()
    expect(screen.queryByTestId('task-image-2')).not.toBeInTheDocument()
  })

  it('omite a seção de imagens quando a tarefa não tem anexo', async () => {
    getMock.mockResolvedValue(makeDetail({ images: [] }))
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo da esteira 3')).toBeInTheDocument())
    expect(screen.queryByText('Imagens')).not.toBeInTheDocument()
  })

  it('omite a seção de Check List quando a tarefa não tem itens', async () => {
    // Caminho real: o toggle do formulário permite salvar sem checklist. O
    // backend costuma gerar 1 item espelhando título+resumo, mas o DTO não
    // garante isso — a tela não pode renderizar um "Check List" vazio.
    getMock.mockResolvedValue(makeDetail({ items: [] }))
    renderAt()
    await waitFor(() => expect(screen.getByText('Reparo da esteira 3')).toBeInTheDocument())
    expect(screen.queryByText('Check List')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('mostra datas em formato brasileiro', async () => {
    renderAt()
    await waitFor(() =>
      expect(screen.getByTestId('task-created-at')).toHaveTextContent('05/03/2026'),
    )
    expect(screen.getByTestId('task-start-date')).toHaveTextContent('01/04/2026')
    expect(screen.getByTestId('task-due-date')).toHaveTextContent('20/05/2026')
  })

  it('mostra o tempo estimado em hh:mm', async () => {
    renderAt()
    await waitFor(() =>
      expect(screen.getByTestId('task-estimated-time')).toHaveTextContent('01:30'),
    )
  })

  it('diz que a data não foi definida quando o backend devolve null', async () => {
    getMock.mockResolvedValue(makeDetail({ startDate: null, dueDate: null }))
    renderAt()
    await waitFor(() => expect(screen.getByTestId('task-start-date')).toBeInTheDocument())
    expect(screen.getByTestId('task-start-date')).toHaveTextContent('Não definida')
    expect(screen.getByTestId('task-due-date')).toHaveTextContent('Não definida')
  })

  it('mostra o progresso da tarefa', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByTestId('task-details-progress')).toBeInTheDocument())
    expect(screen.getByText('Progresso da tarefa')).toBeInTheDocument()
  })

  // A barra sozinha só diz "quanto falta" de forma vaga; o admin precisa do
  // número do tempo gasto ao lado dela.
  it('mostra quanto tempo já se passou, contra a estimativa', async () => {
    getMock.mockResolvedValue(
      makeDetail({
        estimatedMinutes: 60,
        items: [{ ...ITEM_BASE, accumulatedSeconds: 926 }],
      }),
    )
    renderAt()
    await waitFor(() => expect(screen.getByTestId('task-details-elapsed')).toBeInTheDocument())
    expect(screen.getByTestId('task-details-elapsed')).toHaveTextContent(
      'Tempo decorrido: 0:15:26 de 1:00:00',
    )
  })

  it('sem estimativa cadastrada, ainda mostra o tempo gasto e diz que falta a estimativa', async () => {
    getMock.mockResolvedValue(
      makeDetail({
        estimatedMinutes: null,
        items: [{ ...ITEM_BASE, accumulatedSeconds: 90 }],
      }),
    )
    renderAt()
    await waitFor(() => expect(screen.getByTestId('task-details-elapsed')).toBeInTheDocument())
    expect(screen.getByTestId('task-details-elapsed')).toHaveTextContent(
      'Tempo decorrido: 0:01:30 (sem estimativa cadastrada)',
    )
  })

  it('mostra o estado de carregando enquanto a busca não resolve', () => {
    getMock.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(screen.getByTestId('task-details-loading')).toBeInTheDocument()
    // O testID da raiz sobrevive a todos os estados — as rotas dependem dele.
    expect(screen.getByTestId('task-details')).toBeInTheDocument()
  })

  it('mostra a mensagem do ApiError de tarefa inexistente e refaz a busca no retry', async () => {
    getMock.mockRejectedValueOnce(new ApiError('Tarefa não encontrada', 404))
    getMock.mockResolvedValueOnce(makeDetail())
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('task-details-error')).toHaveTextContent('Tarefa não encontrada')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    await waitFor(() => {
      expect(screen.getByText('Reparo da esteira 3')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('task-details-error')).not.toBeInTheDocument()
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('"Editar" navega pro formulário de edição', async () => {
    renderAt('wo_42')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))

    await waitFor(() => expect(screen.getByTestId('task-edit-route')).toBeInTheDocument())
  })

  it('"Voltar" volta pra lista de tarefas', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))

    await waitFor(() => expect(screen.getByTestId('tasks-list-route')).toBeInTheDocument())
  })

  it('não mostra "Ver Todos" quando todos os responsáveis já cabem na prévia', async () => {
    renderAt()
    await waitFor(() => expect(screen.getByTestId('responsible-card-w_1')).toBeInTheDocument())
    expect(screen.getByTestId('responsible-card-w_2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver Todos' })).not.toBeInTheDocument()
  })

  it('"Ver Todos" expande a lista de responsáveis na própria tela', async () => {
    getMock.mockResolvedValue(makeDetail({ responsibles: [ANA, BRUNO, CARLA] }))
    renderAt()
    await waitFor(() => expect(screen.getByTestId('responsible-card-w_1')).toBeInTheDocument())
    // Prévia cortada no tamanho da grade do Figma (2 cards lado a lado).
    expect(screen.queryByTestId('responsible-card-w_3')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ver Todos' }))

    expect(screen.getByTestId('responsible-card-w_3')).toBeInTheDocument()
    // Continua na mesma rota: não há tela de "todos os responsáveis".
    expect(screen.getByTestId('task-details')).toBeInTheDocument()
  })

  it('"Ver menos" recolhe a lista de volta pra prévia', async () => {
    getMock.mockResolvedValue(makeDetail({ responsibles: [ANA, BRUNO, CARLA] }))
    renderAt()
    await waitFor(() => expect(screen.getByTestId('responsible-card-w_1')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Ver Todos' }))
    expect(screen.getByTestId('responsible-card-w_3')).toBeInTheDocument()

    // A volta é a metade que um "esqueci de negar" quebraria: o toggle
    // expandiria e ficaria preso aberto, com o rótulo errado.
    fireEvent.click(screen.getByRole('button', { name: 'Ver menos' }))

    expect(screen.queryByTestId('responsible-card-w_3')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver Todos' })).toBeInTheDocument()
  })

  it('diz que a idade não foi informada quando o responsável não tem data de nascimento', async () => {
    getMock.mockResolvedValue(makeDetail({ responsibles: [CARLA] }))
    renderAt()
    await waitFor(() => expect(screen.getByTestId('responsible-card-w_3')).toBeInTheDocument())
    expect(screen.getByText('Idade não informada')).toBeInTheDocument()
  })

  it('mostra cargo e setor do responsável no card', async () => {
    getMock.mockResolvedValue(makeDetail({ responsibles: [CARLA] }))
    renderAt()
    await waitFor(() => expect(screen.getByTestId('responsible-card-w_3')).toBeInTheDocument())
    expect(screen.getByText('Supervisora')).toBeInTheDocument()
    expect(screen.getByText('Setor Sul')).toBeInTheDocument()
  })
})
