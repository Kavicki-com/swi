// src/app/lazyRoutes.test.tsx
// As páginas autenticadas chegam por React.lazy (ver App.tsx). Esta suíte prova
// os dois lados da fronteira de Suspense: o fallback aparece enquanto o chunk
// não chegou, e a página o substitui quando chega.
//
// O módulo da página é interceptado por um portão: a factory do mock só devolve
// o módulo real depois que o teste libera. Sem isso o teste seria uma corrida,
// porque o import() resolveria junto com o próprio act() e o fallback poderia
// nunca ser observável, fazendo o teste passar ou falhar por temporização.
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/services/api/http'
import { settleAuth } from '@/test-utils/renderPage'
import { App } from './App'

// Roteamento, não chat: passthrough pra que socket e REST não abram.
vi.mock('@/services/chat/ChatProvider', () => ({
  ChatProvider: ({ children }: { children: ReactNode }) => children,
  useChat: () => ({ myId: 'me', conversations: [] }),
}))

// Sem este mock a TasksList cairia no estado de erro e o teste passaria pelo
// motivo errado.
vi.mock('@/services/api/workOrders', () => ({
  workOrdersApi: {
    list: vi.fn(async () => []),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    assignable: vi.fn(),
  },
}))

// Portão do chunk: a promessa fica pendente até `abrir()`.
const portao = vi.hoisted(() => {
  let liberar!: () => void
  const aberto = new Promise<void>((resolve) => {
    liberar = resolve
  })
  return { aberto, abrir: () => liberar() }
})

vi.mock('@/pages/tasks/TasksList', async () => {
  const real =
    await vi.importActual<typeof import('@/pages/tasks/TasksList')>('@/pages/tasks/TasksList')
  await portao.aberto
  return real
})

const SEED_SESSION = JSON.stringify({
  id: 'u_seed_1',
  email: 'admin@swi.test',
  full_name: 'Admin Seed',
  role: 'super_admin',
  consent_given_at: null,
  created_at: '',
})

describe('Rotas carregadas sob demanda', () => {
  beforeEach(() => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
    window.localStorage.setItem(SESSION_STORAGE_KEY, SEED_SESSION)
  })
  afterEach(() => window.localStorage.clear())

  it('mostra o fallback enquanto o chunk não chegou e depois a página', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <App />
      </MemoryRouter>,
    )
    // Resolve a sessão: as rotas passam a renderizar e a página lazy suspende.
    await settleAuth()

    // Com o portão fechado, o fallback é o que está na tela.
    expect(screen.getByTestId('route-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('tasks-list')).not.toBeInTheDocument()
    // O chrome do AppLayout continua montado: a fronteira fica DENTRO dele, e
    // não em volta das rotas, justamente pra sidebar e header não piscarem.
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()

    await act(async () => {
      portao.abrir()
    })

    await waitFor(() => expect(screen.getByTestId('tasks-list')).toBeInTheDocument())
    expect(screen.queryByTestId('route-fallback')).not.toBeInTheDocument()
  })
})
