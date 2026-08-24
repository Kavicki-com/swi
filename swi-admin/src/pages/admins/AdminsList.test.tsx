// Smoke + behaviour tests. The smoke test guards mount regressions (DS bumps,
// route refactors, import-graph changes); the behaviour tests cover the active
// toggle (PATCH via adminsApi.setActive) and the delete flow (confirmação +
// DELETE via adminsApi.remove + remoção otimista) plus esconder o lixo na linha
// do próprio admin logado. Interactions use fireEvent (Testing Library) —
// @testing-library/user-event is not a direct dependency of this app.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { adminsApi, type Admin } from '@/services/api/users'
import { AdminsList } from './AdminsList'
import { clearSession, renderPage } from '@/test-utils/renderPage'

// Espião de navegação (padrão do ChatInbox.test.tsx): o MemoryRouter fica, só o
// useNavigate é observado.
const nav = vi.hoisted(() => ({ spy: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => nav.spy }
})

const ELISA: Admin = {
  id: 'admin-01',
  name: 'Elisa Jordão',
  age: 26,
  bloodType: 'O+',
  role: 'Administradora de Sistema',
  specialization: 'Engenheira Civil',
  avatarUri: 'signed:av-elisa',
  active: true,
  status: 'accept',
}

describe('AdminsList', () => {
  afterEach(() => {
    clearSession()
    vi.restoreAllMocks()
  })

  it('renders without crashing', async () => {
    await expect(renderPage(<AdminsList />, { route: '/admins' })).resolves.toBeDefined()
  })

  // O ícone precisa navegar para a conversa daquele admin: `/chat` sem destino
  // abre sempre a conversa mais recente, não a pessoa clicada.
  it('ícone de chat abre a conversa do admin clicado, não /chat solto', async () => {
    vi.spyOn(adminsApi, 'list').mockResolvedValue({ data: [ELISA], error: null })
    await renderPage(<AdminsList />, { route: '/admins' })
    await waitFor(() => screen.getByText('Elisa Jordão'))

    fireEvent.click(screen.getByRole('button', { name: /conversar com elisa jordão/i }))

    // Sessão semeada: u_seed_1 (renderPage). Key ordenada + '#' encodado.
    expect(nav.spy).toHaveBeenCalledWith('/chat/admin-01%23u_seed_1')
  })

  it('alternar o switch chama adminsApi.setActive(id, novoValor)', async () => {
    vi.spyOn(adminsApi, 'list').mockResolvedValue({ data: [ELISA], error: null })
    const setActive = vi
      .spyOn(adminsApi, 'setActive')
      .mockResolvedValue({ data: { id: 'admin-01', active: false }, error: null })
    await renderPage(<AdminsList />, { route: '/admins' })
    await waitFor(() => screen.getByText('Elisa Jordão'))

    // Estava ativo → o toggle manda desativar (false).
    fireEvent.click(screen.getByRole('switch', { name: /ativar elisa jordão/i }))
    expect(setActive).toHaveBeenCalledWith('admin-01', false)
  })

  it('toggle com erro reverte o switch ao valor original', async () => {
    vi.spyOn(adminsApi, 'list').mockResolvedValue({ data: [ELISA], error: null })
    vi.spyOn(adminsApi, 'setActive').mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    await renderPage(<AdminsList />, { route: '/admins' })
    await waitFor(() => screen.getByText('Elisa Jordão'))

    // Esta versão do react-native-web não emite aria-checked: o estado on/off do
    // Toggle vira a classe atômica de justify-content (thumb à direita/esquerda),
    // então o className do nó do switch muda junto com o valor. É o sinal público
    // disponível pra afirmar "o switch voltou ao estado original".
    const sw = screen.getByRole('switch', { name: /ativar elisa jordão/i })
    const activeClass = sw.className // estado ativo (thumb à direita)

    fireEvent.click(sw)
    // Otimista: muda visualmente pro estado desligado na hora...
    expect(sw.className).not.toBe(activeClass)
    // ...mas o backend recusa → o switch volta pro estado visual original (ativo).
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /ativar elisa jordão/i }).className).toBe(
        activeClass,
      ),
    )
  })

  it('excluir: confirma → remove() e a linha some; cancelar mantém', async () => {
    vi.spyOn(adminsApi, 'list').mockResolvedValue({ data: [ELISA], error: null })
    const remove = vi.spyOn(adminsApi, 'remove').mockResolvedValue({ data: null, error: null })
    await renderPage(<AdminsList />, { route: '/admins' })
    await waitFor(() => screen.getByText('Elisa Jordão'))

    // Abre a confirmação e cancela: nada é removido, a linha continua.
    fireEvent.click(screen.getByRole('button', { name: /excluir elisa jordão/i }))
    expect(screen.getByText('Excluir administrador?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByText('Elisa Jordão')).toBeTruthy()

    // Reabre e confirma: o botão "Excluir" da confirmação (nome exato, sem o
    // nome do admin) dispara a exclusão de fato e a linha some.
    fireEvent.click(screen.getByRole('button', { name: /excluir elisa jordão/i }))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
    expect(remove).toHaveBeenCalledWith('admin-01')
    await waitFor(() => expect(screen.queryByText('Elisa Jordão')).toBeNull())
  })

  it('remove com erro reinsere a linha na posição original (não no fim)', async () => {
    const ALFA: Admin = { ...ELISA, id: 'admin-alfa', name: 'Alfa Admin' }
    const BRAVO: Admin = { ...ELISA, id: 'admin-bravo', name: 'Bravo Admin' }
    vi.spyOn(adminsApi, 'list').mockResolvedValue({ data: [ALFA, BRAVO], error: null })
    vi.spyOn(adminsApi, 'remove').mockResolvedValue({
      data: null,
      error: { message: 'Usuário possui registros vinculados; desative-o em vez de excluir' },
    })
    await renderPage(<AdminsList />, { route: '/admins' })
    await waitFor(() => screen.getByText('Alfa Admin'))

    // Exclui o PRIMEIRO (Alfa, índice 0): abre a confirmação e confirma.
    fireEvent.click(screen.getByRole('button', { name: /excluir alfa admin/i }))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))

    // Removido de forma otimista, mas o backend recusa (409) → reaparece...
    await waitFor(() => expect(screen.getByText('Alfa Admin')).toBeTruthy())
    // ...ANTES de Bravo (posição original 0), não jogado pro fim da lista.
    const alfa = screen.getByText('Alfa Admin')
    const bravo = screen.getByText('Bravo Admin')
    expect(alfa.compareDocumentPosition(bravo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // Mesma correção da EmployeesList, provada aqui porque a lógica é a mesma e
  // já divergiu uma vez: a resposta do list() em voo foi montada ANTES do
  // DELETE, e aplicá-la crua ressuscitava a linha recém-excluída.
  it('lista em voo que chega depois do DELETE não ressuscita a linha', async () => {
    let entregarRefetch: (r: { data: Admin[]; error: null }) => void = () => {}
    vi.spyOn(adminsApi, 'list')
      .mockResolvedValueOnce({ data: [ELISA], error: null })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            entregarRefetch = resolve
          }),
      )
    vi.spyOn(adminsApi, 'remove').mockResolvedValue({ data: null, error: null })

    await renderPage(<AdminsList initialTab="cadastrar" />, { route: '/admins' })
    fireEvent.click(screen.getByRole('button', { name: /voltar para a lista de administradores/i }))
    await waitFor(() => screen.getByText('Elisa Jordão'))
    // Sem o segundo list() em voo o teste não prova nada: `entregarRefetch`
    // seria um no-op e passaria por acidente.
    expect(adminsApi.list).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: /excluir elisa jordão/i }))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))
    await waitFor(() => expect(screen.queryByText('Elisa Jordão')).toBeNull())

    await act(async () => entregarRefetch({ data: [ELISA], error: null }))

    expect(screen.queryByText('Elisa Jordão')).toBeNull()
  })

  // A linha pode sumir da lista entre abrir a confirmação e o backend responder.
  // Reinserir depois disso pintava um admin que o servidor não lista mais.
  it('recusa de linha que já saiu da lista não pinta linha fantasma', async () => {
    const ALFA: Admin = { ...ELISA, id: 'admin-alfa', name: 'Alfa Admin' }
    const BRAVO: Admin = { ...ELISA, id: 'admin-bravo', name: 'Bravo Admin' }
    let entregarRefetch: (r: { data: Admin[]; error: null }) => void = () => {}
    vi.spyOn(adminsApi, 'list')
      .mockResolvedValueOnce({ data: [ALFA, BRAVO], error: null })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            entregarRefetch = resolve
          }),
      )
    vi.spyOn(adminsApi, 'remove').mockResolvedValue({
      data: null,
      error: { message: 'Usuário não encontrado' },
    })

    await renderPage(<AdminsList initialTab="cadastrar" />, { route: '/admins' })
    fireEvent.click(screen.getByRole('button', { name: /voltar para a lista de administradores/i }))
    await waitFor(() => screen.getByText('Alfa Admin'))
    expect(adminsApi.list).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: /excluir alfa admin/i }))
    await act(async () => entregarRefetch({ data: [BRAVO], error: null }))
    fireEvent.click(screen.getByRole('button', { name: /^excluir$/i }))

    await waitFor(() => expect(screen.getByText('Bravo Admin')).toBeTruthy())
    expect(screen.queryByText('Alfa Admin')).toBeNull()
  })

  it('esconde o lixo na linha do próprio admin logado', async () => {
    // A sessão semeada (renderPage) tem id 'u_seed_1'. Um admin com esse id é o
    // próprio usuário logado → não pode oferecer auto-exclusão.
    const SELF: Admin = { ...ELISA, id: 'u_seed_1', name: 'Admin Seed' }
    vi.spyOn(adminsApi, 'list').mockResolvedValue({ data: [SELF, ELISA], error: null })
    await renderPage(<AdminsList />, { route: '/admins' })
    await waitFor(() => screen.getByText('Admin Seed'))

    expect(screen.queryByRole('button', { name: /excluir admin seed/i })).toBeNull()
    // O lixo dos outros admins continua disponível.
    expect(screen.getByRole('button', { name: /excluir elisa jordão/i })).toBeTruthy()

    // Paridade: o Toggle do próprio admin vem desabilitado (nada de
    // self-toggle-off que só round-trip e reverte); o dos outros, não.
    expect(
      screen.getByRole('switch', { name: /ativar admin seed/i }).getAttribute('aria-disabled'),
    ).toBe('true')
    expect(
      screen.getByRole('switch', { name: /ativar elisa jordão/i }).getAttribute('aria-disabled'),
    ).not.toBe('true')
  })
})
