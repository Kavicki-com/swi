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
import { seedSession, clearSession, settled } from '@/test-utils/renderPage'
import type { ReportActivity } from '@/services/api/reports'
import { ReportDetails } from './ReportDetails'

const { getMock, addCommentMock, removeMock, toastShow } = vi.hoisted(() => ({
  getMock: vi.fn(),
  addCommentMock: vi.fn(),
  removeMock: vi.fn(),
  toastShow: vi.fn(),
}))

vi.mock('@/services/api/reports', () => ({
  reportsApi: { get: getMock, addComment: addCommentMock, remove: removeMock },
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
  // Anotados: os casos abaixo sobrescrevem estas listas, e o vazio literal
  // inferiria `never[]`, que recusaria qualquer elemento.
  responsibleAvatars: [] as string[],
  details: 'Detalhes longos.',
  images: [] as string[],
  activities: [] as ReportActivity[],
}

const COMMENT_A = {
  id: 'c_1',
  body: 'Primeiro comentário',
  authorName: 'Mathias Campos',
  authorAvatarUri: '',
  createdAt: '22/07/2026',
}

async function renderAt(
  comments = [] as Array<typeof COMMENT_A>,
  overrides: Partial<typeof BASE_REPORT> = {},
) {
  getMock.mockResolvedValue({ data: { ...BASE_REPORT, ...overrides, comments }, error: null })
  seedSession()
  return settled(
    render(
      <SwiThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/reports/r_1']}>
            <Routes>
              <Route path="/reports" element={<div data-testid="reports-route" />} />
              <Route path="/reports/:id" element={<ReportDetails />} />
              <Route path="/reports/:id/edit" element={<div data-testid="report-edit-route" />} />
              <Route path="/maps/general" element={<div data-testid="maps-route" />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </SwiThemeProvider>,
    ),
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
  removeMock.mockReset()
  toastShow.mockReset()
})

afterEach(clearSession)

describe('ReportDetails — comentários', () => {
  it('renders without crashing', () => {
    expect(() => renderAt()).not.toThrow()
  })

  it('lista os comentários que o get traz (autor + corpo)', async () => {
    await renderAt([COMMENT_A])

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
    await renderAt([COMMENT_A])

    await waitFor(() => expect(screen.getByText('Mathias Campos')).toBeInTheDocument())

    typeComment('  Comentário novo  ')
    sendComment()

    await waitFor(() => expect(addCommentMock).toHaveBeenCalledTimes(1))
    // trim aplicado no envio.
    expect(addCommentMock).toHaveBeenCalledWith('r_1', 'Comentário novo')

    // Comentário retornado aparece na lista…
    await waitFor(() => expect(screen.getByText('Comentário novo')).toBeInTheDocument())
    // …incluindo o authorName que veio do SERVIDOR ('Admin Seed'), não o texto
    // digitado — prova que a lista apenda o objeto RETORNADO, não o input echoado.
    expect(screen.getByText('Admin Seed')).toBeInTheDocument()
    // …e o campo foi limpo.
    expect(screen.getByPlaceholderText('Digite aqui o seu comentário')).toHaveValue('')
  })

  it('não chama o backend com comentário vazio/em branco', async () => {
    await renderAt()
    await waitFor(() => expect(getMock).toHaveBeenCalled())

    typeComment('   ')
    sendComment()

    expect(addCommentMock).not.toHaveBeenCalled()
  })

  it('toasta o erro do backend e mantém o texto digitado', async () => {
    addCommentMock.mockResolvedValue({ data: null, error: { message: 'Falha ao comentar' } })
    await renderAt()
    await waitFor(() => expect(getMock).toHaveBeenCalled())

    typeComment('Meu comentário')
    sendComment()

    await waitFor(() => expect(toastShow).toHaveBeenCalled())
    expect(toastShow.mock.calls[0]).toContain('Falha ao comentar')
    // O texto sobrevive pra nova tentativa.
    expect(screen.getByPlaceholderText('Digite aqui o seu comentário')).toHaveValue(
      'Meu comentário',
    )
  })
})

describe('ReportDetails: carga', () => {
  it('enquanto o get não resolve, mostra o estado de carregamento', async () => {
    getMock.mockReturnValue(new Promise(() => {}))
    seedSession()
    render(
      <SwiThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/reports/r_1']}>
            <Routes>
              <Route path="/reports/:id" element={<ReportDetails />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </SwiThemeProvider>,
    )

    expect(await screen.findByTestId('report-details-loading')).toBeInTheDocument()
  })

  it('resolvido, mostra os campos do relatório', async () => {
    await renderAt()

    expect(await screen.findByTestId('report-details')).toBeInTheDocument()
    expect(screen.getByText('Vazamento na esteira')).toBeInTheDocument()
    expect(screen.getByText('Resumo curto')).toBeInTheDocument()
    expect(screen.getByText('23/07/2026')).toBeInTheDocument()
    expect(screen.getByText('Manutenção')).toBeInTheDocument()
    expect(screen.getByText('Detalhes longos.')).toBeInTheDocument()
  })

  it('sem comentários, a lista some em vez de aparecer vazia', async () => {
    await renderAt()
    await screen.findByTestId('report-details')

    expect(screen.queryByTestId('report-comments')).not.toBeInTheDocument()
  })
})

describe('ReportDetails: responsáveis', () => {
  it('sem avatares de responsável, o grupo não é renderizado', async () => {
    await renderAt()
    await screen.findByTestId('report-details')

    expect(screen.queryByLabelText('Responsável 1')).not.toBeInTheDocument()
  })

  it('até quatro responsáveis aparecem sem contador de excedente', async () => {
    await renderAt([], {
      // Nomes distintos do autor (Elisa Jordão): o avatar do autor usa o mesmo
      // rótulo e a consulta pegaria os dois.
      responsibleAvatars: ['a', 'b'],
      responsibles: 'Mathias Campos, Ana Lima',
    })
    await screen.findByTestId('report-details')

    expect(screen.getByLabelText('Mathias Campos')).toBeInTheDocument()
    expect(screen.getByLabelText('Ana Lima')).toBeInTheDocument()
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument()
  })

  it('acima de quatro, mostra quatro faces e conta o restante', async () => {
    await renderAt([], {
      responsibleAvatars: ['a', 'b', 'c', 'd', 'e', 'f'],
      responsibles: 'Um, Dois, Três, Quatro, Cinco, Seis',
    })
    await screen.findByTestId('report-details')

    expect(screen.getByLabelText('Quatro')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cinco')).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })
})

describe('ReportDetails: imagens e atividades', () => {
  const activity = (over: Partial<ReportActivity> = {}): ReportActivity => ({
    id: 'a_1',
    title: 'Troca de rolamento',
    sector: 'Manutenção',
    progress: 40,
    tone: 'success',
    avatars: [],
    names: [],
    ...over,
  })

  it('renderiza uma miniatura por imagem, rotulada pela posição', async () => {
    await renderAt([], { images: ['u1', 'u2', 'u3'] })
    await screen.findByTestId('report-details')

    expect(screen.getByLabelText('Imagem 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Imagem 3')).toBeInTheDocument()
  })

  it('cada atividade mostra título, setor e equipe nomeada', async () => {
    await renderAt([], {
      activities: [activity({ avatars: ['x', 'y'], names: ['Ana Lima', 'Bruno Souza'] })],
    })
    await screen.findByTestId('report-details')

    expect(screen.getByText('Troca de rolamento')).toBeInTheDocument()
    expect(screen.getByLabelText('Ana Lima')).toBeInTheDocument()
    expect(screen.getByLabelText('Bruno Souza')).toBeInTheDocument()
  })

  it('membro sem nome cai num rótulo posicional em vez de ficar mudo', async () => {
    await renderAt([], { activities: [activity({ avatars: ['x'], names: [] })] })
    await screen.findByTestId('report-details')

    expect(screen.getByLabelText('Membro 1')).toBeInTheDocument()
  })

  it('equipe maior que as faces mostradas exibe o contador de excedente', async () => {
    await renderAt([], {
      activities: [activity({ avatars: ['x'], names: ['Ana Lima'], overflowCount: 13 })],
    })
    await screen.findByTestId('report-details')

    expect(screen.getByText('+13')).toBeInTheDocument()
  })

  it('as três severidades de atividade convivem na mesma lista', async () => {
    await renderAt([], {
      activities: [
        activity({ id: 'a_1', title: 'Em dia', tone: 'success' }),
        activity({ id: 'a_2', title: 'Atrasada', tone: 'warning' }),
        activity({ id: 'a_3', title: 'Parada', tone: 'error' }),
      ],
    })
    await screen.findByTestId('report-details')

    expect(screen.getByText('Em dia')).toBeInTheDocument()
    expect(screen.getByText('Atrasada')).toBeInTheDocument()
    expect(screen.getByText('Parada')).toBeInTheDocument()
  })

  it('progresso fora da faixa é limitado a 0% e 100%', async () => {
    await renderAt([], {
      activities: [
        activity({ id: 'a_1', title: 'Negativa', progress: -20 }),
        activity({ id: 'a_2', title: 'Estourada', progress: 180 }),
      ],
    })
    await screen.findByTestId('report-details')

    const widths = Array.from(document.querySelectorAll('div'))
      .map((el) => (el as HTMLElement).style.width)
      .filter((w) => w.endsWith('%'))
    expect(widths).toContain('0%')
    expect(widths).toContain('100%')
    expect(widths.some((w) => w === '180%' || w === '-20%')).toBe(false)
  })

  it('o pino da atividade leva ao mapa geral', async () => {
    await renderAt([], { activities: [activity()] })
    await screen.findByTestId('report-details')

    fireEvent.click(screen.getByRole('button', { name: 'Localização: Troca de rolamento' }))

    await waitFor(() => expect(screen.getByTestId('maps-route')).toBeInTheDocument())
  })
})

describe('ReportDetails: barra de topo', () => {
  it('"Voltar" retorna para a lista de relatórios', async () => {
    await renderAt()
    await screen.findByTestId('report-details')

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para a lista de relatórios' }))

    await waitFor(() => expect(screen.getByTestId('reports-route')).toBeInTheDocument())
  })

  it('"Fazer comentário" do topo aponta para o campo lá embaixo', async () => {
    await renderAt()
    await screen.findByTestId('report-details')

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar comentário' }))

    expect(toastShow).toHaveBeenCalledWith('Foque no campo Adicionar comentário abaixo')
  })

  it('a busca do relatório aceita texto e limpa', async () => {
    await renderAt()
    await screen.findByTestId('report-details')
    const search = screen.getByPlaceholderText('Pesquisar no relatório')

    fireEvent.change(search, { target: { value: 'esteira' } })
    expect(search).toHaveValue('esteira')
  })
})

describe('ReportDetails — revisar', () => {
  it('"Revisar relatório" navega pra /reports/:id/edit', async () => {
    await renderAt()
    await waitFor(() => expect(getMock).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Revisar relatório' }))

    await waitFor(() => {
      expect(screen.getByTestId('report-edit-route')).toBeInTheDocument()
    })
  })
})

// Excluir relatório. O DELETE /reports/:id existe desde a fatia de CRUD e
// apaga também os anexos do bucket, mas nenhuma tela chamava a rota: um
// relatório aberto por engano ficava para sempre. Por ser destrutivo e
// irreversível, passa pelo ConfirmDialog compartilhado, o mesmo das exclusões
// de funcionário e de admin.
describe('ReportDetails: excluir', () => {
  const excluirNoHeader = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Excluir relatório' }))

  it('cancelar a confirmação não chama o backend nem sai da tela', async () => {
    await renderAt()

    excluirNoHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(removeMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('reports-route')).toBeNull()
  })

  it('confirmar chama o DELETE e volta para a lista', async () => {
    removeMock.mockResolvedValue({ data: null, error: null })
    await renderAt()

    excluirNoHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('r_1'))
    await waitFor(() => expect(screen.getByTestId('reports-route')).toBeTruthy())
  })

  // O relatório não pode sumir da tela antes do servidor confirmar: aqui não
  // cabe exclusão otimista, porque a tela seguinte é outra rota e não haveria
  // para onde voltar. Recusado, o relatório continua inteiro e legível.
  it('erro do backend mantém o relatório na tela e avisa', async () => {
    removeMock.mockResolvedValue({ data: null, error: { message: 'vinculado a uma ordem' } })
    await renderAt()

    excluirNoHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    await waitFor(() => expect(toastShow).toHaveBeenCalled())
    expect(screen.queryByTestId('reports-route')).toBeNull()
    expect(screen.getByText('Vazamento na esteira')).toBeTruthy()
  })
})
