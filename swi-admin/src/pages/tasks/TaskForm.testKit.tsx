// src/pages/tasks/TaskForm.testKit.tsx
// Fixtures e helpers compartilhados pelas suítes do formulário de tarefa
// (TaskForm.create / TaskForm.attachments / TaskForm.edit).
//
// O client de work orders e o de upload são mockados em CADA suíte, não aqui:
// vi.mock é içado por arquivo, então um mock declarado neste módulo não
// valeria para quem o importa. O que mora aqui não depende dos mocks.
//
// O ResponsiblePicker roda de verdade: a integração pai<->overlay (remontagem,
// ids devolvidos) é parte do que as suítes provam.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import type { AssignableWorker, WorkOrderDetail } from '@/services/api/workOrders'
import { seedSession, settled } from '@/test-utils/renderPage'
import { TaskForm } from './TaskForm'

export const CARLOS: AssignableWorker = {
  id: 'w_1',
  name: 'Carlos Silva',
  jobTitle: 'Técnico',
  sector: 'Setor Leste',
  birthDate: '1994-07-22T00:00:00.000Z',
  avatar: '',
}

export const MARIA: AssignableWorker = {
  id: 'w_2',
  name: 'Maria Souza',
  jobTitle: 'Engenheira',
  sector: 'Setor Norte',
  birthDate: null,
  avatar: '',
}

export function detail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: 'wo_7',
    title: 'Manutenção da esteira',
    summary: 'Resumo existente',
    details: 'Detalhes existentes',
    sector: 'Setor Norte',
    estimatedMinutes: 90,
    // ISO datetime, como o backend devolve — NÃO data de calendário.
    startDate: '2026-07-20T00:00:00.000Z',
    dueDate: '2026-07-21T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    status: 'in_progress',
    progressPct: 30,
    author: { name: 'Admin', avatar: '' },
    responsibles: [CARLOS],
    items: [
      {
        id: 'it_1',
        title: 'Item 1',
        description: 'Desc 1',
        status: 'pending',
        startedAt: null,
        accumulatedSeconds: 0,
        estimatedMinutes: null,
      },
    ],
    images: [],
    imageKeys: [],
    ...overrides,
  }
}

// Sonda de rota: prova PRA QUAL tarefa o form navegou depois de salvar.
function TaskDetailsProbe() {
  const { id } = useParams<{ id: string }>()
  return <div data-testid="task-details-route">{id}</div>
}

export async function renderAt(route: string) {
  seedSession()
  return settled(render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/tasks" element={<div data-testid="tasks-route" />} />
            <Route path="/tasks/new" element={<TaskForm />} />
            <Route path="/tasks/:id/edit" element={<TaskForm />} />
            <Route path="/tasks/:id" element={<TaskDetailsProbe />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  ))
}

export function typeIn(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(testID), { target: { value } })
}

// Abre o overlay, marca um trabalhador e confirma.
export async function pickResponsible(name: string, sector: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Atribuir responsáveis' }))
  await waitFor(() => {
    expect(screen.getByRole('checkbox', { name: `Selecionar ${name}, ${sector}` })).toBeVisible()
  })
  fireEvent.click(screen.getByRole('checkbox', { name: `Selecionar ${name}, ${sector}` }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar responsáveis' }))
  await waitFor(() => {
    expect(screen.queryByTestId('responsible-picker')).not.toBeInTheDocument()
  })
}

export function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Salvar tarefa' }))
}

export function jpeg(name = 'foto.jpg') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
}

// Promise controlada pelo teste — pra segurar uma request em voo e escolher o
// instante exato em que ela resolve.
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
