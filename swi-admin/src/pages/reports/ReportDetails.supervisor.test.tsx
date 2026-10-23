// "Excluir" do relatório segue o DELETE /reports/:id do backend: o
// administrador exclui qualquer relatório e o autor exclui o próprio. O
// supervisor que não é o autor não vê o botão (o servidor responderia 403).
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
  authorId: 'u_outra_pessoa',
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

describe('ReportDetails: Excluir para o administrador e para o autor', () => {
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

  // O usuário da sessão semeada é u_seed_1 (test-utils/renderPage).
  it('o supervisor autor do relatório vê Excluir', async () => {
    auth.level = 'SUPERVISOR'
    h.get.mockResolvedValue({ data: { ...REPORT, authorId: 'u_seed_1' }, error: null })
    await renderAt()

    expect(await screen.findByRole('button', { name: 'Excluir relatório' })).toBeTruthy()
  })

  it('relatório sem autor conhecido (backend antigo): o supervisor não vê Excluir', async () => {
    auth.level = 'SUPERVISOR'
    h.get.mockResolvedValue({ data: { ...REPORT, authorId: undefined }, error: null })
    await renderAt()

    expect(await screen.findByRole('button', { name: 'Revisar relatório' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Excluir relatório' })).toBeNull()
  })
})
