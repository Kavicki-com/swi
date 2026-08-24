// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { AdminDetails } from './AdminDetails'
import { adminsApi } from '@/services/api/users'
import { clearSession, renderPage } from '@/test-utils/renderPage'

// Espião de navegação: o MemoryRouter fica, só o useNavigate é observado.
const nav = vi.hoisted(() => ({ spy: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => nav.spy }
})

describe('AdminDetails', () => {
  afterEach(clearSession)

  it('renders without crashing', async () => {
    await expect(renderPage(<AdminDetails />, { route: '/admins/seed_id', path: '/admins/:id' })).resolves.toBeDefined()
  })
})

// O CTA existia e navegava pra /user/settings, que são as configurações de quem
// está LOGADO. Editar o perfil de OUTRA pessoa a partir do detalhe dela levava
// o admin pro próprio cadastro, e salvar ali alterava a pessoa errada.
describe('AdminDetails: editar perfil', () => {
  it('o CTA leva para a edição do admin exibido, não para as próprias configurações', async () => {
    nav.spy.mockClear()
    vi.spyOn(adminsApi, 'get').mockResolvedValue({
      data: {
        id: 'admin-42',
        name: 'Elisa Jordão',
        age: 33,
        bloodType: 'A+',
        role: 'Coordenadora',
        specialization: 'Operações',
        avatarUri: '',
        active: true,
        status: 'accept',
      } as never,
      error: null,
    })
    await renderPage(<AdminDetails />, { route: '/admins/admin-42', path: '/admins/:id' })
    await waitFor(() => screen.getByRole('button', { name: /editar perfil/i }))

    fireEvent.click(screen.getByRole('button', { name: /editar perfil/i }))

    expect(nav.spy).toHaveBeenCalledWith('/admins/admin-42/edit')
  })

  // Esta mesma página serve /user/profile, montada pelo UserProfile com
  // adminId={user.id}. Ali "Editar perfil" É o próprio perfil, e o destino certo
  // continua sendo as configurações da sessão, que é onde moram senha e avatar.
  // Sem esta distinção, consertar o caso do diretório quebraria o caso do
  // próprio perfil, que estava certo desde sempre.
  it('no próprio perfil o CTA continua indo para as configurações da sessão', async () => {
    nav.spy.mockClear()
    vi.spyOn(adminsApi, 'get').mockResolvedValue({
      data: {
        id: 'u_seed_1',
        name: 'Admin Seed',
        age: 40,
        bloodType: 'O+',
        role: 'Admin',
        specialization: 'Geral',
        avatarUri: '',
        active: true,
        status: 'accept',
      } as never,
      error: null,
    })
    await renderPage(<AdminDetails adminId="u_seed_1" />, { route: '/user/profile' })
    await waitFor(() => screen.getByRole('button', { name: /editar perfil/i }))

    fireEvent.click(screen.getByRole('button', { name: /editar perfil/i }))

    expect(nav.spy).toHaveBeenCalledWith('/user/settings')
  })
})
