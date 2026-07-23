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

const { createMock, uploadMock, listMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  uploadMock: vi.fn(),
  listMock: vi.fn(),
}))

vi.mock('@/services/api/reports', () => ({
  reportsApi: { create: createMock },
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
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )
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
  uploadMock.mockReset()
  listMock.mockReset()
  createMock.mockResolvedValue({ data: { id: 'r_new', title: 'Relatório de teste' }, error: null })
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
