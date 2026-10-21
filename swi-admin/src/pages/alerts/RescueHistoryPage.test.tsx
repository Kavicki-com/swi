// Tela /alerts/rescues: histórico de resgates em andamento e encerrados, com as
// ações de registrar chegada e encerrar. describe/it/expect/beforeEach vêm dos
// globals do Vitest. O cliente da API é mockado inteiro (contrato em
// services/api/rescues.test.ts); aqui interessa o comportamento da tela.
import { vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { ApiError } from '@/services/api/http'
import type { Rescue } from '@/services/api/rescues'
import { seedSession, clearSession, settled } from '@/test-utils/renderPage'
import { RescueHistoryPage } from './RescueHistoryPage'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  dispatch: vi.fn(),
  arrive: vi.fn(),
  end: vi.fn(),
}))
vi.mock('@/services/api/rescues', () => ({ rescuesApi: api }))

const DISPATCHED: Rescue = {
  id: 'r1',
  number: 1849,
  status: 'dispatched',
  startedAt: '2026-10-14T12:00:00.000Z',
  arrivedAt: null,
  endedAt: null,
  injured: { id: 'f1', name: 'Ana Ferida' },
  rescuer: { id: 's1', name: 'Bruno Socorro' },
}
const ENDED: Rescue = {
  id: 'r2',
  number: 1800,
  status: 'ended',
  startedAt: '2026-10-13T10:00:00.000Z',
  arrivedAt: '2026-10-13T10:10:00.000Z',
  endedAt: '2026-10-13T11:00:00.000Z',
  injured: { id: 'f2', name: 'Carla Ferida' },
  rescuer: { id: 's2', name: 'Davi Socorro' },
}

function RouteProbe() {
  const location = useLocation()
  return <div data-testid="rescue-route">{`${location.pathname}${location.search}`}</div>
}

async function renderAt(route = '/alerts/rescues') {
  seedSession()
  return settled(
    render(
      <SwiThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path="/alerts/rescues" element={<RescueHistoryPage />} />
              <Route path="/alerts" element={<div data-testid="alerts-route" />} />
              <Route path="/alerts/:employeeId/rescue/:rescuerId" element={<RouteProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </SwiThemeProvider>,
    ),
  )
}

beforeEach(() => {
  api.list.mockReset().mockResolvedValue([DISPATCHED, ENDED])
  api.dispatch.mockReset()
  api.arrive.mockReset()
  api.end.mockReset()
})
afterEach(() => {
  clearSession()
  vi.restoreAllMocks()
})

describe('RescueHistoryPage', () => {
  it('lista resgates em andamento e encerrados, com ferido, socorrista e ID', async () => {
    await renderAt()
    await waitFor(() => expect(screen.getByText('Resgate ID 1849')).toBeInTheDocument())
    expect(screen.getByText('Resgate ID 1800')).toBeInTheDocument()
    expect(screen.getByText(/Ana Ferida/)).toBeInTheDocument()
    expect(screen.getByText(/Bruno Socorro/)).toBeInTheDocument()
    expect(screen.getByText(/Carla Ferida/)).toBeInTheDocument()
  })

  it('o encerrado não tem ação; o em andamento tem registrar chegada e encerrar', async () => {
    await renderAt()
    await waitFor(() => expect(screen.getByText('Resgate ID 1849')).toBeInTheDocument())
    expect(
      screen.getByRole('button', { name: 'Registrar chegada do resgate 1849' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Encerrar resgate 1849' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Encerrar resgate 1800' })).not.toBeInTheDocument()
  })

  it('registrar chegada chama arrive e atualiza a linha para chegou', async () => {
    api.arrive.mockResolvedValue({
      ...DISPATCHED,
      status: 'arrived',
      arrivedAt: '2026-10-14T12:30:00.000Z',
    })
    await renderAt()
    await waitFor(() => expect(screen.getByText('Resgate ID 1849')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Registrar chegada do resgate 1849' }))
    await waitFor(() => expect(api.arrive).toHaveBeenCalledWith('r1'))
    // Depois de chegar não há mais "registrar chegada", mas ainda dá para encerrar.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Registrar chegada do resgate 1849' }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Encerrar resgate 1849' })).toBeInTheDocument()
  })

  it('encerrar chama end e tira as ações da linha', async () => {
    api.end.mockResolvedValue({
      ...DISPATCHED,
      status: 'ended',
      endedAt: '2026-10-14T13:00:00.000Z',
    })
    await renderAt()
    await waitFor(() => expect(screen.getByText('Resgate ID 1849')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar resgate 1849' }))
    await waitFor(() => expect(api.end).toHaveBeenCalledWith('r1'))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Encerrar resgate 1849' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('acompanhar rota reabre a rota de socorro já despachada, com o ID no título', async () => {
    await renderAt()
    await waitFor(() => expect(screen.getByText('Resgate ID 1849')).toBeInTheDocument())
    expect(
      screen.queryByRole('button', { name: 'Acompanhar rota do resgate 1800' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Acompanhar rota do resgate 1849' }))
    await waitFor(() =>
      expect(screen.getByTestId('rescue-route')).toHaveTextContent(
        '/alerts/f1/rescue/s1?dispatched=true&n=1849',
      ),
    )
  })

  it('lista vazia diz que não há resgate', async () => {
    api.list.mockResolvedValue([])
    await renderAt()
    await waitFor(() => expect(screen.getByTestId('rescues-empty')).toBeInTheDocument())
  })

  it('falha ao carregar mostra o erro e tenta de novo', async () => {
    api.list.mockRejectedValueOnce(new ApiError('Sem conexão com o servidor', 0))
    await renderAt()
    await waitFor(() =>
      expect(screen.getByTestId('rescues-error')).toHaveTextContent('Sem conexão com o servidor'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(screen.getByText('Resgate ID 1849')).toBeInTheDocument())
  })

  it('Voltar leva aos alertas', async () => {
    await renderAt()
    await waitFor(() => expect(screen.getByText('Resgate ID 1849')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    await waitFor(() => expect(screen.getByTestId('alerts-route')).toBeInTheDocument())
  })
})
