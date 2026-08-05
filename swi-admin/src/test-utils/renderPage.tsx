// src/test-utils/renderPage.tsx
// Shared helper for smoke-testing page components. Wraps the page in the
// providers the app expects at runtime (SwiThemeProvider for tokens,
// AuthProvider for the useAuth() context, MemoryRouter for any
// useNavigate/useParams/useSearchParams calls) and seeds an authed
// session in localStorage so RequireAuth guards don't redirect.
import type { ReactElement } from 'react'
import { act, render, type RenderResult } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/services/api/http'

const SEED_SESSION = JSON.stringify({
  id: 'u_seed_1',
  email: 'admin@swi.test',
  full_name: 'Admin Seed',
  role: 'super_admin',
  consent_given_at: null,
  created_at: '',
  bpm: 99,
  pressure: '12/8',
})

export function seedSession() {
  // getSession real exige token + sessão; sessão sem token é tratada como órfã.
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
  window.localStorage.setItem(SESSION_STORAGE_KEY, SEED_SESSION)
}

export function clearSession() {
  window.localStorage.clear()
}

/**
 * Drena o microtask em que `getSession()` do AuthProvider resolve, dentro de um
 * escopo de `act`. Sem isso o React acusa "update not wrapped in act(...)": a
 * promise resolve depois de `render()` retornar, fora de qualquer escopo.
 *
 * `renderPage` já faz isso sozinha. Este export é para as suítes que montam o
 * AuthProvider por conta própria, porque precisam de uma árvore de rotas que o
 * helper genérico não cobre.
 */
export async function settleAuth(): Promise<void> {
  await act(async () => {})
}

/**
 * Envolve o resultado de um `render()` próprio, drenando a sessão antes de
 * devolvê-lo: `const renderAt = async () => settled(render(<X />))`.
 * Existe para que helpers de arrow com retorno implícito não precisem virar
 * bloco só para acomodar um await.
 */
export async function settled<T>(result: T): Promise<T> {
  await settleAuth()
  return result
}

type RenderPageOptions = {
  /** URL path to seed MemoryRouter with. Defaults to `/`. */
  route?: string
  /** When the page reads `:param` via useParams, mount it under a matching
   *  `<Routes><Route path=…>` so the param resolves. */
  path?: string
}

/**
 * Render a page component with all the providers it needs at runtime. By
 * default mounts the page as the only route; pass `path` when the page
 * reads dynamic URL params and you want them resolved from `route`.
 *
 * Assíncrona de propósito: o AuthProvider chama `getSession()` ao montar, e
 * essa promise resolve no primeiro microtask — depois de `render()` ter
 * retornado, portanto fora de qualquer escopo de `act`. O `act` vazio abaixo
 * drena esse microtask dentro do escopo certo, que é o que faz o React parar
 * de acusar "update not wrapped in act(...)". Não há como drenar um microtask
 * de forma síncrona: manter a assinatura antiga significaria silenciar o
 * aviso em vez de resolver a corrida que ele denuncia.
 */
export async function renderPage(
  ui: ReactElement,
  { route = '/', path }: RenderPageOptions = {},
): Promise<RenderResult> {
  seedSession()
  const result = render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          {path ? (
            <Routes>
              <Route path={path} element={ui} />
            </Routes>
          ) : (
            ui
          )}
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )
  await act(async () => {})
  return result
}
