// "Gerente responsável" lista a equipe do painel da empresa (administradores e
// supervisores ativos) pela API de usuários, no lugar de nomes fixos no código.
// Arquivo próprio para não inchar o UserSettings.test.tsx.
import { vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { UserSettings } from './UserSettings'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { profileApi } from '@/services/api/profile'
import { examsApi } from '@/services/api/exams'
import { adminsApi } from '@/services/admins'
import type { Admin } from '@/services/admins'

vi.mock('@/services/api/profile', () => ({
  profileApi: { me: vi.fn(), update: vi.fn(), catalog: vi.fn() },
}))
vi.mock('@/services/api/exams', () => ({ examsApi: { list: vi.fn(), create: vi.fn() } }))
vi.mock('@/services/admins', () => ({ adminsApi: { list: vi.fn() } }))

// O DS Combobox não abre em jsdom: vira opções clicáveis, como no teste vizinho.
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
const adminsMock = vi.mocked(adminsApi.list)

const pessoa = (over: Partial<Admin>): Admin => ({
  id: 'a1',
  name: 'Elisa Siqueira',
  age: 30,
  bloodType: 'O+',
  role: 'Engenheira',
  level: 'ADMIN',
  specialization: 'Civil',
  avatarUri: '',
  active: true,
  ...over,
})

const PERFIL = {
  id: 'p1',
  userId: 'u_seed_1',
  fullName: 'Admin Seed',
  phone: null,
  cpf: null,
  birthDate: null,
  cep: null,
  street: null,
  number: null,
  complement: null,
  neighborhood: null,
  city: null,
  uf: null,
  sector: null,
  jobTitle: null,
  duty: null,
  managerName: null,
  gender: null,
  bloodType: null,
  allergies: null,
  chronicConditions: null,
  avatarKey: null,
  avatarUrl: null,
  examKeys: [],
  examUrls: [],
}

const renderSettings = async () => {
  await renderPage(<UserSettings />, { route: '/user/settings' })
  await act(async () => {})
}

beforeEach(() => {
  vi.mocked(profileApi.catalog).mockResolvedValue({
    data: { jobTitles: [], sectors: [], duties: [] },
    error: null,
  })
  vi.mocked(examsApi.list).mockResolvedValue({ data: [], error: null })
  meMock.mockResolvedValue({ data: PERFIL, error: null } as never)
  adminsMock.mockResolvedValue({
    data: [
      pessoa({}),
      pessoa({ id: 'a2', name: 'Marcos Supervisor', level: 'SUPERVISOR' }),
      pessoa({ id: 'a3', name: 'Inativo da Silva', active: false }),
      // O próprio usuário logado (seed da sessão) não é gerente de si mesmo.
      pessoa({ id: 'u_seed_1', name: 'Admin Seed' }),
    ],
    error: null,
  })
})

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('UserSettings: Gerente responsável', () => {
  it('oferece os administradores e supervisores ativos da empresa, sem nomes fixos', async () => {
    await renderSettings()

    expect(screen.getByRole('button', { name: 'Gerente responsável: Elisa Siqueira' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Gerente responsável: Marcos Supervisor' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Gerente responsável: Inativo da Silva' }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Gerente responsável: Admin Seed' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Mathias Campos/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /João Soares Ribeiro/ })).toBeNull()
  })

  it('salva o nome de quem foi escolhido', async () => {
    updateMock.mockResolvedValue({ data: PERFIL, error: null } as never)
    await renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'Gerente responsável: Marcos Supervisor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Alterações' }))

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0]![0].managerName).toBe('Marcos Supervisor')
  })
})
