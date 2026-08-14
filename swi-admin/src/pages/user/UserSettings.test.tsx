// Estes testes travam a fiação REAL do settings: GET /profile/me pré-preenche,
// PUT persiste, senha via /auth/password/change, uploads via presign.
// vitest globals (describe/it/expect/afterEach) via globals: true.
import { vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { UserSettings } from './UserSettings'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { profileApi } from '@/services/api/profile'
import { authApi } from '@/services/api/auth'
import { uploadImage } from '@/services/api/upload'
import { examsApi } from '@/services/api/exams'

vi.mock('@/services/api/profile', () => ({
  profileApi: { me: vi.fn(), update: vi.fn(), catalog: vi.fn() },
}))
// Só o changePassword é mockado — o AuthProvider precisa do getSession real.
vi.mock('@/services/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/auth')>()
  return { ...actual, authApi: { ...actual.authApi, changePassword: vi.fn() } }
})
vi.mock('@/services/api/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/upload')>()
  return { ...actual, uploadImage: vi.fn() }
})
vi.mock('@/services/api/exams', () => ({
  examsApi: { list: vi.fn(), create: vi.fn() },
}))

// O DS Combobox NÃO abre em jsdom (ver nota no NewReport.test.tsx) —
// substituído por opções clicáveis; o resto do DS fica real.
vi.mock('@kavicki/swi-design-system', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kavicki/swi-design-system')>()
  return {
    ...actual,
    Combobox: ({
      label,
      options,
      onChange,
    }: {
      label: string
      options: { label: string; value: string }[]
      onChange: (v: string) => void
    }) => (
      <div>
        <span>{label}</span>
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}>
            {`${label}: ${o.label}`}
          </button>
        ))}
      </div>
    ),
  }
})

const meMock = vi.mocked(profileApi.me)
const updateMock = vi.mocked(profileApi.update)
const catalogMock = vi.mocked(profileApi.catalog)

// Catálogo REAL da organização (DISTINCT do backend), que é a fonte dos selects
// de Profissão, Setor e Função. value === label.
const CATALOG = {
  jobTitles: ['Operador de caminhão', 'Operador de escavadeira'],
  sectors: ['Setor Leste', 'Setor Norte'],
  duties: ['Operação', 'Supervisão'],
}
const changePwMock = vi.mocked(authApi.changePassword)
const uploadMock = vi.mocked(uploadImage)
const examsListMock = vi.mocked(examsApi.list)
const examsCreateMock = vi.mocked(examsApi.create)

// `date` é a VALIDADE, data de calendário 'AAAA-MM-DD'. Futura de propósito:
// é o que o cliente cadastra (exame vale até tal dia).
const EXAME = {
  id: 'e1',
  name: 'Audiometria',
  date: '2027-03-05',
  fileUrl: 'https://exemplo/e1.pdf',
}

const DTO = {
  id: 'p1',
  userId: 'u_seed_1',
  fullName: 'Ana Prado',
  phone: '(31) 99999 0000',
  cpf: '111.222.333-44',
  birthDate: '1990-05-04T00:00:00.000Z',
  cep: null,
  street: null,
  number: null,
  complement: null,
  neighborhood: null,
  city: 'Belo Horizonte',
  uf: 'MG',
  sector: 'Setor Leste',
  jobTitle: 'Operador de caminhão',
  duty: 'Operação',
  managerName: 'João Soares Ribeiro',
  gender: 'Feminino',
  bloodType: 'O+',
  allergies: 'Poeira',
  chronicConditions: '',
  avatarKey: null,
  avatarUrl: null,
  examKeys: ['exams/2b0f7c1a-1111-2222-3333-444455556666.jpg'],
  examUrls: ['https://s3/view/exams/e1.jpg'],
}

const renderSettings = async () => {
  await renderPage(<UserSettings />, { route: '/user/settings' })
  // Flush do getSession do AuthProvider + do profileApi.me do mount.
  await act(async () => {})
}

const typeIn = (testID: string, value: string) =>
  fireEvent.change(screen.getByTestId(testID), { target: { value } })

beforeEach(() => {
  catalogMock.mockResolvedValue({ data: CATALOG, error: null })
  examsListMock.mockResolvedValue({ data: [], error: null })
})

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('UserSettings', () => {
  it('renders without crashing', async () => {
    meMock.mockResolvedValue({ data: null, error: null })
    await expect(renderPage(<UserSettings />, { route: '/user/settings' })).resolves.toBeDefined()
    await act(async () => {})
  })

  it('pré-preenche o form com o perfil real (nada de Carlos Sampaio)', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    await renderSettings()

    expect((screen.getByTestId('settings-name') as HTMLInputElement).value).toBe('Ana Prado')
    expect((screen.getByTestId('settings-dob') as HTMLInputElement).value).toBe('04/05/1990')
    expect((screen.getByTestId('settings-cpf') as HTMLInputElement).value).toBe('111.222.333-44')
    expect((screen.getByTestId('settings-city') as HTMLInputElement).value).toBe('Belo Horizonte')
    expect(screen.queryByDisplayValue('Carlos Sampaio')).toBeNull()
    expect(screen.queryByDisplayValue('00/00/0000')).toBeNull()
  })

  it('Salvar Alterações → PUT com o patch mapeado (labels dos selects, data ISO)', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    updateMock.mockResolvedValue({ data: DTO, error: null })
    await renderSettings()

    typeIn('settings-name', 'Ana P. Alterada')
    typeIn('settings-dob', '05/06/1991')
    fireEvent.click(screen.getByRole('button', { name: 'Função: Supervisão' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Alterações' }))

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    const patch = updateMock.mock.calls[0]![0]
    expect(patch.fullName).toBe('Ana P. Alterada')
    expect(patch.birthDate).toBe('1991-06-05')
    expect(patch.duty).toBe('Supervisão')
    // Round-trip dos selects carregados: label → value → label.
    expect(patch.jobTitle).toBe('Operador de caminhão')
    expect(patch.sector).toBe('Setor Leste')
    expect(patch.managerName).toBe('João Soares Ribeiro')
    // gender é CÓDIGO, não rótulo: gravar 'Feminino' faz quem lê o campo
    // comparando com 'female' (detalhe do funcionário, painel do chat) cair no
    // default. O fixture traz o rótulo legado de propósito, o readGender o
    // aceita na leitura, e o patch volta normalizado.
    expect(patch.gender).toBe('female')
    expect(patch.bloodType).toBe('O+')
  })

  // Os campos são string livre no banco e o catálogo é DISTINCT — mas pode
  // haver corrida (perfil chega antes do catálogo) ou valor recém-gravado por
  // outra tela. withCurrent injeta o valor atual pra ele se exibir e
  // sobreviver ao save.
  it('cargo/setor fora do catálogo: exibe o valor do perfil e NÃO o apaga ao salvar', async () => {
    meMock.mockResolvedValue({
      data: { ...DTO, jobTitle: 'Administrador', sector: 'Gestão' },
      error: null,
    })
    updateMock.mockResolvedValue({ data: DTO, error: null })
    await renderSettings()

    // O mock do Combobox renderiza um botão por opção — o valor do perfil
    // precisa estar entre elas, senão o DS cai no placeholder.
    expect(screen.getByRole('button', { name: 'Profissão: Administrador' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Setor: Gestão' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Salvar Alterações' }))

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    const patch = updateMock.mock.calls[0]![0]
    expect(patch.jobTitle).toBe('Administrador')
    expect(patch.sector).toBe('Gestão')
  })

  it('valor que já está no catálogo não é duplicado nas opções', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    await renderSettings()

    // DTO traz 'Operador de caminhão', que ESTÁ no catálogo: a injeção do
    // withCurrent não pode criar uma segunda linha idêntica.
    expect(screen.getAllByRole('button', { name: 'Profissão: Operador de caminhão' })).toHaveLength(
      1,
    )
    expect(screen.getAllByRole('button', { name: 'Setor: Setor Leste' })).toHaveLength(1)
  })

  it('Alterar senha: nova ≠ repetição → erro e NENHUMA chamada', async () => {
    meMock.mockResolvedValue({ data: null, error: null })
    await renderSettings()

    typeIn('settings-current-pw', 'atual123')
    typeIn('settings-new-pw', 'nova1234')
    typeIn('settings-confirm-pw', 'outra999')
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }))

    expect(await screen.findByTestId('form-error')).toBeTruthy()
    expect(changePwMock).not.toHaveBeenCalled()
  })

  it('Alterar senha válida → POST real com current/new', async () => {
    meMock.mockResolvedValue({ data: null, error: null })
    changePwMock.mockResolvedValue({ data: { changed: true }, error: null })
    await renderSettings()

    typeIn('settings-current-pw', 'atual123')
    typeIn('settings-new-pw', 'nova1234')
    typeIn('settings-confirm-pw', 'nova1234')
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }))

    await waitFor(() =>
      expect(changePwMock).toHaveBeenCalledWith({
        currentPassword: 'atual123',
        newPassword: 'nova1234',
      }),
    )
  })

  it('Editar foto → upload no namespace avatars/ + PUT avatarKey', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    updateMock.mockResolvedValue({ data: DTO, error: null })
    uploadMock.mockResolvedValue('avatars/2b0f7c1a-aaaa-bbbb-cccc-444455556666.png')
    await renderSettings()

    const file = new File(['x'], 'foto.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('settings-avatar-input'), { target: { files: [file] } })

    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(file, 'avatars'))
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith({
        avatarKey: 'avatars/2b0f7c1a-aaaa-bbbb-cccc-444455556666.png',
      }),
    )
  })
})

// O exame enviado pelo painel grava na tabela Exam, a MESMA que o app e o
// detalhe do funcionário leem. Gravar em Profile.examKeys guardaria só a chave
// do arquivo, e sem nome nem validade nenhuma tela consegue desenhar o card: o
// usuário manda o arquivo e ele some de vista.
describe('UserSettings — exames clínicos', () => {
  it('lista os exames existentes como card, com nome e validade', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    examsListMock.mockResolvedValue({ data: [EXAME], error: null })
    await renderSettings()

    expect(await screen.findByText('Audiometria')).toBeTruthy()
    // O card separa ano de dia/mês (ExamInfoCard do DS).
    expect(screen.getByText('2027')).toBeTruthy()
    expect(screen.getByText('05 Mar')).toBeTruthy()
  })

  it('sem exame nenhum, diz isso em vez de deixar o espaço mudo', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    await renderSettings()

    expect(await screen.findByText(/nenhum exame enviado/i)).toBeTruthy()
  })

  it('não mostra mais o contador "(N no perfil)" do fluxo antigo', async () => {
    // DTO ainda traz examKeys (a coluna foi deprecada, não removida). Ela não
    // pode voltar a alimentar a tela, senão o contador mente sobre a fonte real.
    meMock.mockResolvedValue({ data: DTO, error: null })
    await renderSettings()

    expect(screen.queryByText(/no perfil/i)).toBeNull()
  })

  it('exige nome antes de deixar anexar, e diz qual campo falta', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    await renderSettings()

    typeIn('settings-exam-date', '05/03/2027')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar exame' }))

    expect(await screen.findByText(/informe o nome do exame/i)).toBeTruthy()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('exige validade em dd/mm/aaaa antes de deixar anexar', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    await renderSettings()

    typeIn('settings-exam-name', 'Audiometria')
    // Passa no formato mas não existe no calendário. O regex sozinho aceitaria.
    typeIn('settings-exam-date', '31/02/2027')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar exame' }))

    // Casa a MENSAGEM, não o rótulo "Validade" do campo, que existe sempre.
    expect(await screen.findByText(/validade inválida/i)).toBeTruthy()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('nome + validade + arquivo → sobe em exams/ e cadastra na tabela Exam', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    uploadMock.mockResolvedValue('exams/2b0f7c1a-aaaa-bbbb-cccc-444455556666.pdf')
    examsCreateMock.mockResolvedValue({ data: EXAME, error: null })
    await renderSettings()

    typeIn('settings-exam-name', 'Audiometria')
    typeIn('settings-exam-date', '05/03/2027')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar exame' }))

    const pdf = new File(['x'], 'audiometria.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByTestId('settings-exams-input'), { target: { files: [pdf] } })

    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(pdf, 'exams'))
    await waitFor(() =>
      expect(examsCreateMock).toHaveBeenCalledWith({
        name: 'Audiometria',
        // dd/mm/aaaa da UI vira data de calendário na API.
        date: '2027-03-05',
        fileKey: 'exams/2b0f7c1a-aaaa-bbbb-cccc-444455556666.pdf',
      }),
    )
    // O PUT do perfil não pode mais ser usado pra exame: era ele que fazia o
    // arquivo cair numa fonte que nenhuma tela lê.
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('depois de enviar, o card aparece e o estado vazio some', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    uploadMock.mockResolvedValue('exams/2b0f7c1a-aaaa-bbbb-cccc-444455556666.pdf')
    examsCreateMock.mockResolvedValue({ data: EXAME, error: null })
    await renderSettings()

    expect(await screen.findByText(/nenhum exame enviado/i)).toBeTruthy()

    typeIn('settings-exam-name', 'Audiometria')
    typeIn('settings-exam-date', '05/03/2027')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar exame' }))
    fireEvent.change(screen.getByTestId('settings-exams-input'), {
      target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] },
    })

    // É exatamente o sintoma reportado: o arquivo subia e não aparecia.
    expect(await screen.findByText('Audiometria')).toBeTruthy()
    expect(screen.queryByText(/nenhum exame enviado/i)).toBeNull()
  })

  it('falha no cadastro não finge que deu certo', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    uploadMock.mockResolvedValue('exams/2b0f7c1a-aaaa-bbbb-cccc-444455556666.pdf')
    examsCreateMock.mockResolvedValue({ data: null, error: { message: 'Falha ao enviar o exame' } })
    await renderSettings()

    typeIn('settings-exam-name', 'Audiometria')
    typeIn('settings-exam-date', '05/03/2027')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar exame' }))
    fireEvent.change(screen.getByTestId('settings-exams-input'), {
      target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] },
    })

    await waitFor(() => expect(examsCreateMock).toHaveBeenCalled())
    expect(screen.queryByText('Audiometria')).toBeNull()
    expect(await screen.findByText(/nenhum exame enviado/i)).toBeTruthy()
  })

  it('o input de exame aceita pdf e txt; o de avatar continua só imagem', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    await renderSettings()

    const accept = screen.getByTestId('settings-exams-input').getAttribute('accept') ?? ''
    expect(accept).toContain('application/pdf')
    expect(accept).toContain('text/plain')
    // Foto de perfil em PDF não renderiza em lugar nenhum do painel.
    expect(screen.getByTestId('settings-avatar-input').getAttribute('accept')).toBe(
      'image/jpeg,image/png',
    )
  })
})
