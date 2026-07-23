// Comportamento do formulário de novo relatório — criação real via
// reportsApi.create. describe/it/expect/beforeEach vêm dos globals do Vitest.
//
// O client de relatórios, o de upload e o de admins são mockados inteiros: o
// contrato deles já é coberto nos seus próprios *.test. Aqui interessa o
// comportamento da tela — forma do payload, upload no submit, o handoff do
// overlay de responsáveis SEM perder o formulário, e a navegação.
import { vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { seedSession, clearSession } from '@/test-utils/renderPage'
import { NewReport } from './NewReport'

const { createMock, updateMock, getMock, uploadMock, listMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  getMock: vi.fn(),
  uploadMock: vi.fn(),
  listMock: vi.fn(),
}))

vi.mock('@/services/api/reports', () => ({
  reportsApi: { create: createMock, update: updateMock, get: getMock },
}))

vi.mock('@/services/api/upload', () => ({
  uploadImage: uploadMock,
  MAX_UPLOAD_BYTES: 15 * 1024 * 1024,
}))

vi.mock('@/services/admins', () => ({
  adminsApi: { list: listMock },
}))

// Admins mínimos pro overlay — só os campos que a AdminPickRow lê.
const ELISA = {
  id: 'admin-01',
  name: 'Elisa Siqueira Jordão',
  age: 26,
  bloodType: 'O+',
  role: 'Administradora de Sistema',
  specialization: 'Engenheira Civil',
  avatarUri: '',
  active: true,
}
const MATHIAS = {
  id: 'admin-02',
  name: 'Mathias Campos S.',
  age: 32,
  bloodType: 'AB-',
  role: 'Segurança do trabalho',
  specialization: 'Técnico',
  avatarUri: '',
  active: true,
}

function renderAt(route = '/reports/new') {
  seedSession()
  return render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/reports" element={<div data-testid="reports-route" />} />
            <Route path="/reports/new" element={<NewReport />} />
            <Route path="/reports/:id" element={<div data-testid="report-detail-route" />} />
            <Route path="/reports/:id/edit" element={<NewReport />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )
}

// Relatório mínimo que o reportsApi.get devolve no modo edição — só os campos
// que a tela lê pra pré-preencher. `responsibles` é a string comma-joined do
// Report; `responsibleNames` são os nomes CRUS (array) que a edição usa pra
// re-semear sem split lossy; `imageKeys` são as keys crus preservadas no PATCH.
const EDIT_REPORT = {
  id: 'r_9',
  title: 'Relatório existente',
  summary: 'Resumo existente',
  status: 'accept' as const,
  statusLabel: 'Concluído',
  authorName: 'Elisa Jordão',
  authorAvatarUri: '',
  creationDate: '20/07/2026',
  sector: 'Manutenção',
  responsibles: 'Elisa Siqueira Jordão, Mathias Campos S.',
  responsibleNames: ['Elisa Siqueira Jordão', 'Mathias Campos S.'],
  responsibleAvatars: [],
  responsibleTotalCount: 2,
  details: 'Detalhes existentes',
  images: ['https://presigned/existing-1.jpg'],
  activities: [],
  comments: [],
  imageKeys: ['reports/existing-1.jpg', 'reports/existing-2.jpg'],
}

function typeIn(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(testID), { target: { value } })
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Salvar relatório' }))
}

function jpeg(name = 'foto.jpg') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
}

// Abre o overlay, marca um admin pelo nome e confirma.
async function pickResponsible(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Atribuir responsáveis ao relatório' }))
  await waitFor(() => {
    expect(screen.getByRole('radio', { name: `Selecionar ${name} como responsável` })).toBeVisible()
  })
  fireEvent.click(screen.getByRole('radio', { name: `Selecionar ${name} como responsável` }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))
  await waitFor(() => {
    expect(screen.queryByTestId('responsables-modal')).not.toBeInTheDocument()
  })
}

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset()
  getMock.mockReset()
  uploadMock.mockReset()
  listMock.mockReset()
  createMock.mockResolvedValue({ data: { id: 'r_new', title: 'Relatório de teste' }, error: null })
  updateMock.mockResolvedValue({ data: { id: 'r_9', title: 'Relatório existente' }, error: null })
  getMock.mockResolvedValue({ data: EDIT_REPORT, error: null })
  uploadMock.mockResolvedValue('reports/aaa.jpg')
  listMock.mockResolvedValue({ data: [ELISA, MATHIAS], error: null })
})

afterEach(clearSession)

describe('NewReport — criação', () => {
  it('exige o título antes de chamar o backend', async () => {
    renderAt()

    save()

    await waitFor(() => {
      expect(screen.getByTestId('new-report-error')).toHaveTextContent(/título/i)
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('salva com o título e navega pra lista de relatórios', async () => {
    renderAt()
    typeIn('new-report-title', 'Vazamento na esteira')
    typeIn('new-report-summary', 'Resumo curto')
    typeIn('new-report-details', 'Detalhes longos do relatório')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({
      title: 'Vazamento na esteira',
      summary: 'Resumo curto',
      details: 'Detalhes longos do relatório',
    })
    await waitFor(() => expect(screen.getByTestId('reports-route')).toBeInTheDocument())
  })

  it('sem resumo/detalhes/responsáveis/anexos, o payload não traz essas chaves', async () => {
    renderAt()
    typeIn('new-report-title', 'Só o título')

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    const payload = createMock.mock.calls[0]?.[0]
    expect(payload).toEqual({
      title: 'Só o título',
      summary: undefined,
      details: undefined,
      responsibles: undefined,
      imageKeys: undefined,
    })
  })

  it('mostra o erro do backend sem sair da tela', async () => {
    createMock.mockResolvedValue({ data: null, error: { message: 'Título já usado' } })
    renderAt()
    typeIn('new-report-title', 'Vazamento na esteira')

    save()

    await waitFor(() => {
      expect(screen.getByTestId('new-report-error')).toHaveTextContent('Título já usado')
    })
    expect(screen.queryByTestId('reports-route')).not.toBeInTheDocument()
    expect(screen.getByTestId('new-report-title')).toHaveValue('Vazamento na esteira')
  })
})

describe('NewReport — anexos', () => {
  it('só sobe o arquivo no submit, com prefix "reports", e manda a key', async () => {
    renderAt()
    typeIn('new-report-title', 'Com anexo')

    const file = jpeg()
    fireEvent.change(screen.getByTestId('new-report-file-input'), { target: { files: [file] } })

    // O presign vale 300 s: subir na seleção faria um form lento estourar o TTL.
    expect(uploadMock).not.toHaveBeenCalled()

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(uploadMock).toHaveBeenCalledWith(file, 'reports')
    expect(createMock.mock.calls[0]?.[0].imageKeys).toEqual(['reports/aaa.jpg'])
  })

  it('acumula arquivos de seleções separadas na ordem escolhida', async () => {
    uploadMock.mockResolvedValueOnce('reports/a.jpg').mockResolvedValueOnce('reports/b.png')
    renderAt()
    typeIn('new-report-title', 'Dois anexos')

    const input = screen.getByTestId('new-report-file-input')
    fireEvent.change(input, { target: { files: [jpeg('a.jpg')] } })
    fireEvent.change(input, { target: { files: [jpeg('b.png')] } })

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(uploadMock).toHaveBeenCalledTimes(2)
    expect(createMock.mock.calls[0]?.[0].imageKeys).toEqual(['reports/a.jpg', 'reports/b.png'])
  })

  it('retry após create falhar REAPROVEITA a key (não sobe o arquivo de novo)', async () => {
    // 1º save: upload OK, mas create rejeita (4xx do backend). 2º save: o
    // arquivo NÃO deve subir de novo (a key já resolvida é reusada) e o create
    // manda o MESMO imageKeys — sem mintar key órfã.
    createMock
      .mockResolvedValueOnce({ data: null, error: { message: 'Título já usado' } })
      .mockResolvedValueOnce({ data: { id: 'r_new', title: 'Com anexo' }, error: null })
    renderAt()
    typeIn('new-report-title', 'Com anexo')
    fireEvent.change(screen.getByTestId('new-report-file-input'), { target: { files: [jpeg()] } })

    save()
    await waitFor(() => {
      expect(screen.getByTestId('new-report-error')).toHaveTextContent('Título já usado')
    })
    expect(uploadMock).toHaveBeenCalledTimes(1)

    save()
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2))
    // A 2ª tentativa não reenviou o arquivo…
    expect(uploadMock).toHaveBeenCalledTimes(1)
    // …e mandou a MESMA key do 1º upload.
    expect(createMock.mock.calls[1]?.[0].imageKeys).toEqual(['reports/aaa.jpg'])
  })

  it('recusa mais de 20 anexos sem subir NENHUM arquivo nem criar o relatório', async () => {
    renderAt()
    typeIn('new-report-title', 'Muitos anexos')

    const twentyOne = Array.from({ length: 21 }, (_, i) => jpeg(`foto_${i}.jpg`))
    fireEvent.change(screen.getByTestId('new-report-file-input'), { target: { files: twentyOne } })

    await waitFor(() => {
      expect(screen.getByTestId('new-report-error')).toHaveTextContent(
        'Anexe no máximo 20 arquivos por relatório.',
      )
    })
    // O teto vale na SELEÇÃO: nada subiu e nada ficou pendurado pro submit.
    expect(uploadMock).not.toHaveBeenCalled()

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(uploadMock).not.toHaveBeenCalled()
    expect(createMock.mock.calls[0]?.[0].imageKeys).toBeUndefined()
  })

  it('falha de upload mostra o erro e NÃO cria o relatório', async () => {
    uploadMock.mockRejectedValue(new Error('O link de envio expirou.'))
    renderAt()
    typeIn('new-report-title', 'Com anexo')
    fireEvent.change(screen.getByTestId('new-report-file-input'), { target: { files: [jpeg()] } })

    save()

    await waitFor(() => {
      expect(screen.getByTestId('new-report-error')).toHaveTextContent('O link de envio expirou.')
    })
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('NewReport — responsáveis (handoff do overlay sem perder o form)', () => {
  it('os nomes escolhidos vão no create e o formulário sobrevive à ida e volta', async () => {
    renderAt()
    typeIn('new-report-title', 'Inspeção mensal')
    typeIn('new-report-summary', 'Resumo preenchido antes de abrir o overlay')

    await pickResponsible('Elisa Siqueira Jordão')

    // O formulário NÃO desmontou: título e resumo continuam preenchidos.
    expect(screen.getByTestId('new-report-title')).toHaveValue('Inspeção mensal')
    expect(screen.getByTestId('new-report-summary')).toHaveValue(
      'Resumo preenchido antes de abrir o overlay',
    )
    // E o nome escolhido aparece no resumo de responsáveis da tela.
    expect(screen.getByTestId('new-report-responsibles-summary')).toHaveTextContent(
      'Elisa Siqueira Jordão',
    )

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    const payload = createMock.mock.calls[0]?.[0]
    expect(payload.responsibles).toEqual(['Elisa Siqueira Jordão'])
    expect(payload.title).toBe('Inspeção mensal')
    expect(payload.summary).toBe('Resumo preenchido antes de abrir o overlay')
  })

  it('reabrir o overlay parte da seleção já confirmada em vez de zerá-la', async () => {
    renderAt()
    typeIn('new-report-title', 'Inspeção mensal')

    await pickResponsible('Elisa Siqueira Jordão')

    // Reabre e marca MAIS alguém — a seleção anterior tem que estar pré-marcada
    // (initialSelectedNames), então confirmar soma em vez de substituir.
    fireEvent.click(screen.getByRole('button', { name: 'Atribuir responsáveis ao relatório' }))
    await waitFor(() => {
      expect(
        screen.getByRole('radio', { name: 'Selecionar Mathias Campos S. como responsável' }),
      ).toBeVisible()
    })
    fireEvent.click(
      screen.getByRole('radio', { name: 'Selecionar Mathias Campos S. como responsável' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))
    await waitFor(() => {
      expect(screen.queryByTestId('responsables-modal')).not.toBeInTheDocument()
    })

    save()

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0].responsibles).toEqual([
      'Elisa Siqueira Jordão',
      'Mathias Campos S.',
    ])
  })
})

describe('NewReport — edição (revisão)', () => {
  it('carrega o relatório e pré-preenche título/resumo/detalhes/status', async () => {
    renderAt('/reports/r_9/edit')

    // O get roda com o id da rota.
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('r_9'))

    // Título muda pra "Editar relatório" e os campos vêm pré-preenchidos.
    await waitFor(() => {
      expect(screen.getByTestId('new-report-title')).toHaveValue('Relatório existente')
    })
    expect(screen.getByText('Editar relatório')).toBeInTheDocument()
    expect(screen.getByTestId('new-report-summary')).toHaveValue('Resumo existente')
    expect(screen.getByTestId('new-report-details')).toHaveValue('Detalhes existentes')
    // O Combobox de status mostra o rótulo do status carregado.
    expect(screen.getByText('Concluído')).toBeInTheDocument()
    // Os nomes vêm do array cru `responsibleNames` (não do split da string).
    expect(screen.getByTestId('new-report-responsibles-summary')).toHaveTextContent(
      'Elisa Siqueira Jordão',
    )
    expect(screen.getByTestId('new-report-responsibles-summary')).toHaveTextContent(
      'Mathias Campos S.',
    )
  })

  it('muda um campo e salva → update com (id, patch) e navega pro detalhe', async () => {
    renderAt('/reports/r_9/edit')

    await waitFor(() => {
      expect(screen.getByTestId('new-report-title')).toHaveValue('Relatório existente')
    })

    typeIn('new-report-title', 'Relatório revisado')
    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    // NÃO cria — é edição.
    expect(createMock).not.toHaveBeenCalled()
    expect(updateMock.mock.calls[0]?.[0]).toBe('r_9')
    const patch = updateMock.mock.calls[0]?.[1]
    expect(patch).toMatchObject({
      title: 'Relatório revisado',
      summary: 'Resumo existente',
      details: 'Detalhes existentes',
      status: 'accept',
      statusLabel: 'Concluído',
    })
    // As keys crus existentes são PRESERVADAS no PATCH.
    expect(patch.imageKeys).toEqual(
      expect.arrayContaining(['reports/existing-1.jpg', 'reports/existing-2.jpg']),
    )
    // Sucesso volta pro detalhe do relatório.
    await waitFor(() => expect(screen.getByTestId('report-detail-route')).toBeInTheDocument())
  })

  it('sobe anexo NOVO e MESCLA com as keys existentes no PATCH', async () => {
    uploadMock.mockResolvedValueOnce('reports/nova.jpg')
    renderAt('/reports/r_9/edit')

    await waitFor(() => {
      expect(screen.getByTestId('new-report-title')).toHaveValue('Relatório existente')
    })

    fireEvent.change(screen.getByTestId('new-report-file-input'), { target: { files: [jpeg()] } })
    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(uploadMock).toHaveBeenCalledWith(expect.any(File), 'reports')
    // Existentes preservadas + nova, nessa ordem.
    expect(updateMock.mock.calls[0]?.[1].imageKeys).toEqual([
      'reports/existing-1.jpg',
      'reports/existing-2.jpg',
      'reports/nova.jpg',
    ])
  })

  it('erro do backend no update toasta e NÃO navega', async () => {
    updateMock.mockResolvedValue({ data: null, error: { message: 'Falha no servidor' } })
    renderAt('/reports/r_9/edit')

    await waitFor(() => {
      expect(screen.getByTestId('new-report-title')).toHaveValue('Relatório existente')
    })

    typeIn('new-report-title', 'Relatório revisado')
    save()

    await waitFor(() => {
      expect(screen.getByTestId('new-report-error')).toHaveTextContent('Falha no servidor')
    })
    expect(screen.queryByTestId('report-detail-route')).not.toBeInTheDocument()
  })

  it('get {data:null} (404/rede) mostra estado de não-encontrado, não um form vazio', async () => {
    getMock.mockResolvedValue({ data: null, error: { message: 'Relatório não encontrado' } })
    renderAt('/reports/r_9/edit')

    await waitFor(() => {
      expect(screen.getByTestId('new-report-not-found')).toBeInTheDocument()
    })
    // Não deixa o usuário num formulário de edição vazio.
    expect(screen.queryByTestId('new-report-title')).not.toBeInTheDocument()
  })

  // O par status→statusLabel do PATCH. O DS Combobox NÃO abre em jsdom (precisa
  // de measureInWindow pra medir o trigger e renderizar o painel), então clicar
  // numa opção de status é impossível aqui. Em vez de forjar um clique que não
  // acontece, semeamos cada status pelo caminho de carga (reportsApi.get) e
  // provamos que o rótulo enviado no PATCH é DERIVADO do status (STATUS_LABELS),
  // não ecoado do statusLabel carregado — por isso o get devolve um statusLabel
  // proposital-errado. Cobre os 4 pares.
  it.each([
    ['accept', 'Concluído'],
    ['pending', 'Em Revisão'],
    ['info', 'Em Andamento'],
    ['canceled', 'Cancelado'],
  ] as const)('status %s → statusLabel %s no PATCH', async (status, statusLabel) => {
    getMock.mockResolvedValue({
      data: { ...EDIT_REPORT, status, statusLabel: 'RÓTULO-ERRADO-DO-BACKEND' },
      error: null,
    })
    renderAt('/reports/r_9/edit')

    await waitFor(() => {
      expect(screen.getByTestId('new-report-title')).toHaveValue('Relatório existente')
    })
    typeIn('new-report-title', 'Alterado')
    save()

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    const patch = updateMock.mock.calls[0]?.[1]
    expect(patch.status).toBe(status)
    // Derivado do status, não o statusLabel carregado.
    expect(patch.statusLabel).toBe(statusLabel)
  })
})
