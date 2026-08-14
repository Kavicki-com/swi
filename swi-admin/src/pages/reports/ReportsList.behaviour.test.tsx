// Comportamento da lista de relatórios. O smoke vizinho só monta a página;
// aqui ficam as regras que aparecem com volume: filtros derivados do que
// existe (nunca uma opção que devolve vazio), paginação local antes de bater no
// servidor, e um rodapé que conta a verdade sobre quantos registros ficaram
// fora da tela.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { ReportsList } from './ReportsList'
import { clearSession, renderPage } from '@/test-utils/renderPage'

const h = vi.hoisted(() => ({ list: vi.fn(), navigations: [] as string[] }))

vi.mock('@/services/api/reports', () => ({ reportsApi: { list: h.list } }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => (to: string) => {
      h.navigations.push(to)
    },
  }
})

const brDate = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

const report = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  status: 'info',
  statusLabel: 'Em Andamento',
  title: 'Vazamento na bomba 3',
  summary: 'Resumo do relatório',
  creationDate: brDate(1),
  authorName: 'Ana Lima',
  authorAvatarUri: '',
  sector: 'Operação',
  responsibleAvatars: [],
  responsibleTotalCount: 0,
  ...over,
})

const renderList = () => renderPage(<ReportsList />, { route: '/reports' })

beforeEach(() => {
  vi.clearAllMocks()
  h.navigations = []
  h.list.mockResolvedValue({ data: [report()], count: 1 })
})

afterEach(clearSession)

describe('ReportsList: carga e busca', () => {
  it('desenha um card por relatório carregado', async () => {
    h.list.mockResolvedValue({
      data: [report(), report({ id: 'r2', title: 'Queda de energia' })],
      count: 2,
    })
    await renderList()

    expect(await screen.findByText('Vazamento na bomba 3')).toBeTruthy()
    expect(screen.getByText('Queda de energia')).toBeTruthy()
  })

  it('sem header de total, o total vira o tamanho da resposta', async () => {
    h.list.mockResolvedValue({ data: [report()], count: undefined })
    await renderList()
    expect(await screen.findByText('Mostrando 1 de 1')).toBeTruthy()
  })

  it('a busca por título recorta a grade', async () => {
    h.list.mockResolvedValue({
      data: [report(), report({ id: 'r2', title: 'Queda de energia' })],
      count: 2,
    })
    await renderList()
    await screen.findByText('Vazamento na bomba 3')

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Pesquisar relatório'), {
        target: { value: 'queda' },
      })
    })

    await waitFor(() => expect(screen.queryByText('Vazamento na bomba 3')).toBeNull())
    expect(screen.getByText('Queda de energia')).toBeTruthy()
  })

  it('resposta vazia não quebra a tela e o rodapé diz zero', async () => {
    h.list.mockResolvedValue({ data: [], count: 0 })
    await renderList()
    expect(await screen.findByText('Mostrando 0 de 0')).toBeTruthy()
  })
})

describe('ReportsList: rodapé de volume', () => {
  it('com mais registros no servidor do que na resposta, mostra o total e oferece carregar mais', async () => {
    h.list.mockResolvedValue({ data: [report()], count: 262 })
    await renderList()

    expect(await screen.findByText(/Mostrando 1 de 1/)).toBeTruthy()
    expect(screen.getByText(/\(262 no total\)/)).toBeTruthy()
    expect(screen.getByLabelText('Carregar mais relatórios do servidor')).toBeTruthy()
  })

  it('carregar mais pede a próxima página pelo offset e concatena', async () => {
    h.list.mockResolvedValueOnce({ data: [report()], count: 2 })
    h.list.mockResolvedValueOnce({
      data: [report({ id: 'r2', title: 'Queda de energia' })],
      count: 2,
    })
    await renderList()
    await screen.findByText('Vazamento na bomba 3')

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Carregar mais relatórios do servidor'))
    })

    expect(h.list).toHaveBeenLastCalledWith({ offset: 1 })
    expect(await screen.findByText('Queda de energia')).toBeTruthy()
  })

  it('acima de uma página, "Ver mais" desenha o restante sem ir ao servidor', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      report({ id: `r${i}`, title: `Relatório ${i}` }),
    )
    h.list.mockResolvedValue({ data: many, count: 30 })
    await renderList()

    expect(await screen.findByText('Mostrando 24 de 30')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Ver mais relatórios'))
    })

    expect(await screen.findByText('Mostrando 30 de 30')).toBeTruthy()
    expect(h.list).toHaveBeenCalledTimes(1)
  })

  it('tudo à vista e nada a mais no servidor: nenhum botão de rodapé', async () => {
    await renderList()
    await screen.findByText('Mostrando 1 de 1')

    expect(screen.queryByLabelText('Ver mais relatórios')).toBeNull()
    expect(screen.queryByLabelText('Carregar mais relatórios do servidor')).toBeNull()
  })
})

describe('ReportsList: navegação', () => {
  it('o CTA leva ao formulário de novo relatório', async () => {
    await renderList()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Criar novo relatório'))
    })

    expect(h.navigations).toEqual(['/reports/new'])
  })

  it('clicar no card abre o detalhe daquele relatório', async () => {
    await renderList()

    await act(async () => {
      fireEvent.click(await screen.findByText('Vazamento na bomba 3'))
    })

    expect(h.navigations).toEqual(['/reports/r1'])
  })
})
