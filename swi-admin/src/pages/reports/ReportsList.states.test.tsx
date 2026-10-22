// Estados da lista de relatórios que não são "lista com cards": carregando,
// falha (com nova tentativa), nenhum relatório e busca sem resultado.
import { vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { ReportsList } from './ReportsList'

const h = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/services/api/reports', () => ({ reportsApi: { list: h.list } }))

const report = {
  id: 'r1',
  status: 'info',
  statusLabel: 'Em Andamento',
  title: 'Vazamento na bomba 3',
  summary: 'Resumo',
  creationDate: '01/10/2026',
  authorName: 'Ana Lima',
  authorAvatarUri: '',
  sector: 'Operação',
  responsibleAvatars: [],
  responsibleTotalCount: 0,
}

const renderList = () => renderPage(<ReportsList />, { route: '/reports' })

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('ReportsList: estados', () => {
  it('enquanto a lista não chega, mostra o carregando', async () => {
    h.list.mockReturnValue(new Promise(() => {}))
    await renderList()

    expect(screen.getByTestId('reports-loading')).toBeTruthy()
    expect(screen.queryByTestId('reports-footer')).toBeNull()
  })

  it('falha mostra o erro e Tentar novamente busca de novo', async () => {
    h.list.mockResolvedValue({ data: null, error: { message: 'Falha ao carregar' } })
    await renderList()

    expect(screen.getByTestId('reports-error').textContent).toBe('Falha ao carregar')
    expect(screen.queryByTestId('reports-footer')).toBeNull()

    h.list.mockResolvedValue({ data: [report], count: 1, error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await act(async () => {})

    expect(screen.getByText('Vazamento na bomba 3')).toBeTruthy()
    expect(screen.queryByTestId('reports-error')).toBeNull()
  })

  it('sem nenhum relatório, diz isso em vez de uma grade vazia', async () => {
    h.list.mockResolvedValue({ data: [], count: 0, error: null })
    await renderList()

    expect(screen.getByTestId('reports-empty').textContent).toBe('Nenhum relatório ainda')
  })

  it('busca sem resultado diz que não há resultado', async () => {
    h.list.mockResolvedValue({ data: [report], count: 1, error: null })
    await renderList()

    fireEvent.change(screen.getByPlaceholderText('Pesquisar relatório'), {
      target: { value: 'guindaste' },
    })

    expect(screen.getByTestId('reports-no-match').textContent).toBe('Nenhum resultado')
  })
})
