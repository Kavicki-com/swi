// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router).
//
// QA de volume (2026-07-26): a régua "Filtro de status" navegava entre as 3
// rotas mas a lista NUNCA era filtrada — as três abas mostravam a população
// inteira enquanto o badge vermelho anunciava a contagem de fadiga. Os testes
// abaixo travam o filtro, a expansão inicial (que comparava com o id mock
// 'emp-04' e morreu quando os ids viraram UUID) e o "Ver Todos".
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { MonitoringLayout } from './MonitoringLayout'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { monitoringApi } from '@/services/monitoring'

vi.mock('@/services/monitoring', () => ({
  monitoringApi: { kpis: vi.fn(), alertUsers: vi.fn() },
}))

const kpisMock = vi.mocked(monitoringApi.kpis)
const alertUsersMock = vi.mocked(monitoringApi.alertUsers)

const pessoa = (id: string, name: string, tier: 'excelente' | 'desgastado' | 'alerta-fadiga') => ({
  id,
  name,
  age: 32,
  bloodType: 'A+',
  role: 'Operador',
  specialization: 'Setor Leste',
  avatarUri: '',
  active: true,
  tier,
  alerts:
    tier === 'alerta-fadiga'
      ? [
          {
            id: `${id}-bpm`,
            icon: 'heart_filled' as const,
            title: 'Frequência cardíaca crítica',
            description: '135 bpm — limite recomendado: 100 bpm',
            tone: 'error' as const,
          },
        ]
      : tier === 'desgastado'
        ? [
            {
              id: `${id}-pressao`,
              icon: 'av_timer' as const,
              title: 'Tensão arterial elevada',
              description: 'Pressão 14/9 — desgaste em 55%',
              tone: 'warning' as const,
            },
          ]
        : [],
})

// 2 em fadiga, 1 desgastado, 2 excelentes — mesma forma da população real.
const POPULACAO = [
  pessoa('u-fad-1', 'Fadiga Um', 'alerta-fadiga'),
  pessoa('u-fad-2', 'Fadiga Dois', 'alerta-fadiga'),
  pessoa('u-desg-1', 'Desgastado Um', 'desgastado'),
  pessoa('u-exc-1', 'Excelente Um', 'excelente'),
  pessoa('u-exc-2', 'Excelente Dois', 'excelente'),
]

const renderAt = async (route: string) => {
  renderPage(<MonitoringLayout />, { route })
  await act(async () => {})
}

const nomesVisiveis = () =>
  POPULACAO.filter((p) => screen.queryByText(p.name) !== null).map((p) => p.name)

beforeEach(() => {
  kpisMock.mockResolvedValue({ data: [], error: null })
  alertUsersMock.mockResolvedValue({ data: POPULACAO, error: null })
})

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('MonitoringLayout', () => {
  it('renders without crashing', () => {
    expect(() => renderPage(<MonitoringLayout />, { route: '/monitoring/alerts' })).not.toThrow()
  })

  it('/monitoring/alerts lista SÓ quem está em alerta de fadiga', async () => {
    await renderAt('/monitoring/alerts')
    expect(nomesVisiveis()).toEqual(['Fadiga Um', 'Fadiga Dois'])
  })

  it('/monitoring/desgastados lista SÓ os desgastados', async () => {
    await renderAt('/monitoring/desgastados')
    expect(nomesVisiveis()).toEqual(['Desgastado Um'])
  })

  it('/monitoring/good-conditions lista SÓ os excelentes', async () => {
    await renderAt('/monitoring/good-conditions')
    expect(nomesVisiveis()).toEqual(['Excelente Um', 'Excelente Dois'])
  })

  it('abre o primeiro card de fadiga por id REAL (era o mock "emp-04")', async () => {
    await renderAt('/monitoring/alerts')
    // O detalhe do alerta só existe no DOM quando o card está expandido.
    expect(screen.getAllByText('Frequência cardíaca crítica')).toHaveLength(1)
    // CTA que só existe dentro do bloco expandido (label visível difere do
    // accessibilityLabel — ver MonitoringLayout.tsx:221-228).
    expect(screen.getByRole('button', { name: 'Ver histórico de exames clínicos' })).toBeTruthy()
  })

  it('"Ver Todos" derruba o filtro e mostra a população inteira', async () => {
    await renderAt('/monitoring/alerts')
    expect(nomesVisiveis()).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /Ver todos os funcionários/ }))
    await act(async () => {})

    expect(nomesVisiveis()).toHaveLength(POPULACAO.length)
  })
})
