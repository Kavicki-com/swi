// QA F (2026-07-24): o settings inteiro era fake — prefill mock ('Carlos
// Sampaio'), Salvar/Alterar senha/Editar foto/Enviar exames eram toasts
// simulados. Estes testes travam a fiação REAL: GET /profile/me pré-preenche,
// PUT persiste, senha via /auth/password/change, uploads via presign.
// vitest globals (describe/it/expect/afterEach) via globals: true.
import { vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { UserSettings } from './UserSettings'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { profileApi } from '@/services/api/profile'
import { authApi } from '@/services/api/auth'
import { uploadImage } from '@/services/api/upload'

vi.mock('@/services/api/profile', () => ({
  profileApi: { me: vi.fn(), update: vi.fn() },
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
const changePwMock = vi.mocked(authApi.changePassword)
const uploadMock = vi.mocked(uploadImage)

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
  renderPage(<UserSettings />, { route: '/user/settings' })
  // Flush do getSession do AuthProvider + do profileApi.me do mount.
  await act(async () => {})
}

const typeIn = (testID: string, value: string) =>
  fireEvent.change(screen.getByTestId(testID), { target: { value } })

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('UserSettings', () => {
  it('renders without crashing', async () => {
    meMock.mockResolvedValue({ data: null, error: null })
    expect(() => renderPage(<UserSettings />, { route: '/user/settings' })).not.toThrow()
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
    expect(patch.gender).toBe('Feminino')
    expect(patch.bloodType).toBe('O+')
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

  it('Enviar exames → upload exams/ de cada arquivo + PUT examKeys MESCLANDO os existentes', async () => {
    meMock.mockResolvedValue({ data: DTO, error: null })
    updateMock.mockResolvedValue({ data: DTO, error: null })
    uploadMock
      .mockResolvedValueOnce('exams/2b0f7c1a-aaaa-bbbb-cccc-444455556666.jpg')
      .mockResolvedValueOnce('exams/2b0f7c1a-dddd-eeee-ffff-444455556666.png')
    await renderSettings()

    const a = new File(['a'], 'exame-a.jpg', { type: 'image/jpeg' })
    const b = new File(['b'], 'exame-b.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('settings-exams-input'), { target: { files: [a, b] } })

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2))
    expect(uploadMock).toHaveBeenNthCalledWith(1, a, 'exams')
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith({
        examKeys: [
          'exams/2b0f7c1a-1111-2222-3333-444455556666.jpg', // pré-existente preservado
          'exams/2b0f7c1a-aaaa-bbbb-cccc-444455556666.jpg',
          'exams/2b0f7c1a-dddd-eeee-ffff-444455556666.png',
        ],
      }),
    )
  })
})
