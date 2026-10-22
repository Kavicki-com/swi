// Cadastrar, editar e excluir câmera é só do administrador (cameras.manage na
// matriz do backend; o supervisor recebe 403). O supervisor vê as câmeras sem
// os controles de gestão.
import { vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { Camera } from '@/services/api/cameras'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { CamerasPage } from './CamerasPage'

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }))
vi.mock('@/services/api/cameras', () => ({ camerasApi: api }))
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => null }))

// O nível vem do token; aqui cada teste escolhe o seu, sobre a sessão real.
const auth = vi.hoisted(() => ({ level: 'ADMIN' as 'ADMIN' | 'SUPERVISOR' }))
vi.mock('@/hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAuth')>()
  return {
    ...actual,
    useAuth: () => {
      const real = actual.useAuth()
      return { ...real, user: real.user ? { ...real.user, level: auth.level } : real.user }
    },
  }
})

const PORTARIA: Camera = {
  id: 'c1',
  name: 'Portaria',
  lat: -3.1,
  lng: -60.02,
  url: 'https://cameras.exemplo.com.br/portaria',
} as Camera

const renderCameras = () => renderPage(<CamerasPage />, { route: '/cameras' })

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
  auth.level = 'ADMIN'
})

describe('CamerasPage: gestão só para o administrador', () => {
  it('o administrador vê Nova câmera, Editar e Excluir', async () => {
    api.list.mockResolvedValue([PORTARIA])
    await renderCameras()

    expect(await screen.findByRole('button', { name: 'Ver câmera Portaria' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nova câmera' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Editar Portaria' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Excluir Portaria' })).toBeTruthy()
  })

  it('o supervisor vê a câmera sem Nova câmera, Editar e Excluir', async () => {
    auth.level = 'SUPERVISOR'
    api.list.mockResolvedValue([PORTARIA])
    await renderCameras()

    expect(await screen.findByRole('button', { name: 'Ver câmera Portaria' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Nova câmera' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar Portaria' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Excluir Portaria' })).toBeNull()
  })

  it('sem câmera, o supervisor não é mandado usar o botão que não tem', async () => {
    auth.level = 'SUPERVISOR'
    api.list.mockResolvedValue([])
    await renderCameras()

    expect((await screen.findByTestId('cameras-empty')).textContent).toBe(
      'Nenhuma câmera cadastrada.',
    )
  })
})
