// src/app/tasksRoutes.test.tsx
// Prova o ranking de rotas do React Router pras telas de Tarefas: o segmento
// estático /tasks/new tem que ganhar do dinâmico /tasks/:id, senão "new" vira
// um id e o usuário cai no detalhe em vez do formulário.
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/services/api/http'
import type { WorkOrderDetail } from '@/services/api/workOrders'
import { App } from './App'

// App agora monta o ChatProvider real acima do AppLayout (task B5). Aqui o teste
// é de roteamento de Tarefas, não de chat: mockamos o módulo com um ChatProvider
// passthrough e um useChat() de conversas vazias, pra que o socket/REST reais
// não disparem e a sidebar renderize vazia (o que está sob teste é o ranking das
// rotas de /tasks dentro do shell do AppLayout).
vi.mock('@/services/chat/ChatProvider', () => ({
  ChatProvider: ({ children }: { children: ReactNode }) => children,
  useChat: () => ({ myId: 'me', conversations: [] }),
}))

// Detalhe mínimo pro TaskDetails montar pelo caminho feliz. `get: vi.fn()` sem
// implementação devolveria undefined e a tela quebraria no `.then` — o teste
// falharia por um TypeError, não por erro de roteamento.
const DETAIL: WorkOrderDetail = {
  id: 'wo_123',
  title: 'Tarefa de rota',
  summary: '',
  details: '',
  sector: '',
  estimatedMinutes: null,
  startDate: null,
  dueDate: null,
  createdAt: '2026-03-05T00:00:00.000Z',
  status: 'in_progress',
  progressPct: 0,
  author: { name: 'Autor', avatar: '' },
  responsibles: [],
  items: [],
  images: [],
  imageKeys: [],
}

// Teste de roteamento, não de dados: sem este mock a TasksList dispararia um
// fetch real contra localhost dentro do jsdom e o teste passaria só porque a
// tela cai no estado de erro. Mockado, o /tasks monta pelo caminho feliz.
vi.mock('@/services/api/workOrders', () => ({
  workOrdersApi: {
    list: vi.fn(async () => []),
    get: vi.fn(async () => DETAIL),
    create: vi.fn(),
    update: vi.fn(),
    assignable: vi.fn(),
  },
}))

const SEED_SESSION = JSON.stringify({
  id: 'u_seed_1',
  email: 'admin@swi.test',
  full_name: 'Admin Seed',
  role: 'super_admin',
  consent_given_at: null,
  created_at: '',
})

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  )
}

describe('Rotas de Tarefas', () => {
  beforeEach(() => {
    // getSession real exige token + sessão.
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
    window.localStorage.setItem(SESSION_STORAGE_KEY, SEED_SESSION)
  })
  afterEach(() => window.localStorage.clear())

  it('/tasks renderiza a lista', async () => {
    renderAt('/tasks')
    await waitFor(() => {
      expect(screen.getByTestId('tasks-list')).toBeInTheDocument()
    })
  })

  it('/tasks/new renderiza o formulário e NÃO o detalhe', async () => {
    renderAt('/tasks/new')
    await waitFor(() => {
      expect(screen.getByTestId('task-form')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('task-details')).not.toBeInTheDocument()
  })

  it('/tasks/:id renderiza o detalhe', async () => {
    renderAt('/tasks/wo_123')
    await waitFor(() => {
      expect(screen.getByTestId('task-details')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('task-form')).not.toBeInTheDocument()
  })

  it('/tasks/:id/edit renderiza o formulário', async () => {
    renderAt('/tasks/wo_123/edit')
    await waitFor(() => {
      expect(screen.getByTestId('task-form')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('task-details')).not.toBeInTheDocument()
  })

  it('monta as telas de Tarefas dentro do AppLayout (sidebar presente)', async () => {
    renderAt('/tasks/new')
    await waitFor(() => {
      expect(screen.getByTestId('task-form')).toBeInTheDocument()
    })
    // O item de menu só existe se o AppLayout envolveu a rota.
    expect(screen.getByRole('button', { name: 'Tarefas' })).toBeInTheDocument()
  })
})
