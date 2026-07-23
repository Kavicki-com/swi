// Comportamento do detalhe do relatório — lista e criação de comentários via
// reportsApi.get / reportsApi.addComment. describe/it/expect/beforeEach vêm dos
// globals do Vitest.
//
// O client de relatórios é mockado inteiro (contrato coberto no seu próprio
// *.test); aqui interessa a tela: renderizar os comentários que o get traz,
// mandar o novo comentário com (id, body), apendá-lo na lista e limpar o campo,
// e toastar o erro sem perder o texto. O demoToast é mockado pra espiar o show.
import { vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/hooks/useAuth'
import { seedSession, clearSession } from '@/test-utils/renderPage'
import { ReportDetails } from './ReportDetails'

const { getMock, addCommentMock, toastShow } = vi.hoisted(() => ({
  getMock: vi.fn(),
  addCommentMock: vi.fn(),
  toastShow: vi.fn(),
}))

vi.mock('@/services/api/reports', () => ({
  reportsApi: { get: getMock, addComment: addCommentMock },
}))

vi.mock('@/lib/demoToast', () => ({
  useDemoToast: () => ({ show: toastShow }),
  DemoToastProvider: ({ children }: { children: ReactNode }) => children,
}))

// Report mínimo — só os campos que a tela lê no caminho renderizado.
const BASE_REPORT = {
  id: 'r_1',
  title: 'Vazamento na esteira',
  summary: 'Resumo curto',
  status: 'accept' as const,
  statusLabel: 'Concluído',
  authorName: 'Elisa Jordão',
  authorAvatarUri: '',
  creationDate: '23/07/2026',
  sector: 'Manutenção',
  responsibles: 'Elisa Jordão',
  responsibleAvatars: [],
  details: 'Detalhes longos.',
  images: [],
  activities: [],
}

const COMMENT_A = {
  id: 'c_1',
  body: 'Primeiro comentário',
  authorName: 'Mathias Campos',
  authorAvatarUri: '',
  createdAt: '22/07/2026',
}

function renderAt(comments = [] as Array<typeof COMMENT_A>) {
  getMock.mockResolvedValue({ data: { ...BASE_REPORT, comments }, error: null })
  seedSession()
  return render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/reports/r_1']}>
          <Routes>
            <Route path="/reports" element={<div data-testid="reports-route" />} />
            <Route path="/reports/:id" element={<ReportDetails />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )
}

function typeComment(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Digite aqui o seu comentário'), {
    target: { value },
  })
}

function sendComment() {
  fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }))
}

beforeEach(() => {
  getMock.mockReset()
  addCommentMock.mockReset()
  toastShow.mockReset()
})

afterEach(clearSession)

describe('ReportDetails — comentários', () => {
  it('renders without crashing', () => {
    expect(() => renderAt()).not.toThrow()
  })

  it('lista os comentários que o get traz (autor + corpo)', async () => {
    renderAt([COMMENT_A])

    await waitFor(() => {
      expect(screen.getByText('Mathias Campos')).toBeInTheDocument()
    })
    expect(screen.getByText('Primeiro comentário')).toBeInTheDocument()
  })

  it('envia o comentário com (id, body), apenda na lista e limpa o campo', async () => {
    addCommentMock.mockResolvedValue({
      data: {
        id: 'c_new',
        body: 'Comentário novo',
        authorName: 'Admin Seed',
        authorAvatarUri: '',
        createdAt: '23/07/2026',
      },
      error: null,
    })
    renderAt([COMMENT_A])

    await waitFor(() => expect(screen.getByText('Mathias Campos')).toBeInTheDocument())

    typeComment('  Comentário novo  ')
    sendComment()

    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1))
    // trim aplicado no envio.
    expect(addCommentMock).toHaveBeenCalledWith('r_1', 'Comentário novo')

    // Comentário retornado aparece na lista…
    await waitFor(() => expect(screen.getByText('Comentário novo')).toBeInTheDocument())
    // …e o campo foi limpo.
    expect(screen.getByPlaceholderText('Digite aqui o seu comentário')).toHaveValue('')
  })

  it('não chama o backend com comentário vazio/em branco', async () => {
    renderAt()
    await waitFor(() => expect(getMock).toHaveBeenCalled())

    typeComment('   ')
    sendComment()

    expect(addCommentMock).not.toHaveBeenCalled()
  })

  it('toasta o erro do backend e mantém o texto digitado', async () => {
    addCommentMock.mockResolvedValue({ data: null, error: { message: 'Falha ao comentar' } })
    renderAt()
    await waitFor(() => expect(getMock).toHaveBeenCalled())

    typeComment('Meu comentário')
    sendComment()

    await waitFor(() => expect(toastShow).toHaveBeenCalled())
    expect(toastShow.mock.calls[0]).toContain('Falha ao comentar')
    // O texto sobrevive pra nova tentativa.
    expect(screen.getByPlaceholderText('Digite aqui o seu comentário')).toHaveValue('Meu comentário')
  })
})
