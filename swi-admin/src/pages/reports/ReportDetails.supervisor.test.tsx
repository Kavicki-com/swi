// "Excluir" do relatório segue reports.delete da matriz do backend, que é só do
// administrador: o supervisor não vê o botão (o servidor responderia 403).
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { screen } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { ReportDetails } from './ReportDetails'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/services/api/reports', () => ({
  reportsApi: { get: h.get, addComment: vi.fn(), remove: vi.fn() },
}))
vi.mock('@/lib/demoToast', () => ({
  useDemoToast: () => ({ show: vi.fn() }),
  DemoToastProvider: ({ children }: { children: ReactNode }) => children,
}))
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

const REPORT = {
  id: 'r_1',
  title: 'Vazamento na esteira',
  summary: 'Resumo curto',
  status: 'accept',
  statusLabel: 'Concluído',
  authorName: 'Elisa Jordão',
  authorAvatarUri: '',
  creationDate: '23/07/2026',
  sector: 'Manutenção',
  responsibles: 'Elisa Jordão',
  responsibleAvatars: [],
  details: 'Detalhes longos.',
  images: [],
  attachments: [],
  activities: [],
  comments: [],
}

const renderAt = () => renderPage(<ReportDetails />, { route: '/reports/r_1', path: '/reports/:id' })

beforeEach(() => h.get.mockResolvedValue({ data: REPORT, error: null }))

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
  auth.level = 'ADMIN'
})

describe('ReportDetails: Excluir só para o administrador', () => {
  it('o administrador vê Excluir', async () => {
    await renderAt()
    expect(await screen.findByRole('button', { name: 'Excluir relatório' })).toBeTruthy()
  })

  it('o supervisor não vê Excluir, e segue comentando e revisando', async () => {
    auth.level = 'SUPERVISOR'
    await renderAt()

    expect(await screen.findByRole('button', { name: 'Revisar relatório' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Adicionar comentário' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Excluir relatório' })).toBeNull()
  })
})
