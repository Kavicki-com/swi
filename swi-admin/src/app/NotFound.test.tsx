// Endereço que não existe no painel: em vez da tela em branco, a página 404
// dentro do layout, com o caminho de volta para a home.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/services/api/http'
import { App } from './App'

const SEED_SESSION = JSON.stringify({
  id: 'u_seed_1',
  email: 'admin@swi.test',
  full_name: 'Admin Seed',
  role: 'super_admin',
  consent_given_at: null,
  created_at: '',
})

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

afterEach(() => window.localStorage.clear())

describe('Página 404', () => {
  it('logado, um endereço inexistente mostra a 404 e Voltar leva à home', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
    window.localStorage.setItem(SESSION_STORAGE_KEY, SEED_SESSION)
    renderAt('/endereco-que-nao-existe')

    const page = await screen.findByTestId('not-found')
    expect(page.textContent).toContain('404')
    expect(page.textContent).toContain('Tela não encontrada.')

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    await waitFor(() => expect(screen.queryByTestId('not-found')).toBeNull())
  })

  it('a antiga rota solta do modal de responsáveis não existe mais', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
    window.localStorage.setItem(SESSION_STORAGE_KEY, SEED_SESSION)
    renderAt('/modals/responsables')

    expect(await screen.findByTestId('not-found')).toBeTruthy()
    expect(screen.queryByTestId('responsables-modal')).toBeNull()
  })

  it('deslogado, o endereço inexistente segue para o login', async () => {
    renderAt('/endereco-que-nao-existe')

    await waitFor(() => expect(screen.queryByTestId('not-found')).toBeNull())
    expect(await screen.findByTestId('login-page')).toBeTruthy()
  })
})
