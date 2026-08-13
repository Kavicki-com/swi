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

// Espião de navegação (padrão do ChatInbox.test.tsx): o MemoryRouter fica, só o
// useNavigate é observado.
const nav = vi.hoisted(() => ({ spy: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => nav.spy }
})

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
  await renderPage(<MonitoringLayout />, { route })
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
  it('renders without crashing', async () => {
    await expect(
      renderPage(<MonitoringLayout />, { route: '/monitoring/alerts' }),
    ).resolves.toBeDefined()
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

  // QA Web #10: mesmo bug das listas de funcionários/admins — /chat sem destino
  // abre sempre a conversa mais recente, não a pessoa do card clicado.
  it('ícone de chat abre a conversa da pessoa do card, não /chat solto', async () => {
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByRole('button', { name: /chat com fadiga um/i }))

    // Sessão semeada: u_seed_1 (renderPage). Key ordenada + '#' encodado.
    expect(nav.spy).toHaveBeenCalledWith('/chat/u-fad-1%23u_seed_1')
  })

  it('"Ver Todos" derruba o filtro e mostra a população inteira', async () => {
    await renderAt('/monitoring/alerts')
    expect(nomesVisiveis()).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /Ver todos os funcionários/ }))
    await act(async () => {})

    expect(nomesVisiveis()).toHaveLength(POPULACAO.length)
  })

  it('a busca filtra por nome dentro da aba, sem diferenciar maiúsculas', async () => {
    await renderAt('/monitoring/alerts')

    fireEvent.change(screen.getByPlaceholderText('Pesquisar funcionário'), {
      target: { value: 'fadiga DOIS' },
    })
    await act(async () => {})

    expect(nomesVisiveis()).toEqual(['Fadiga Dois'])
  })

  it('busca sem correspondência esvazia a lista', async () => {
    await renderAt('/monitoring/alerts')

    fireEvent.change(screen.getByPlaceholderText('Pesquisar funcionário'), {
      target: { value: 'ninguém' },
    })
    await act(async () => {})

    expect(nomesVisiveis()).toEqual([])
  })

  it('o badge conta quem está em fadiga agora, não um número fixo', async () => {
    await renderAt('/monitoring/alerts')

    expect(screen.getByLabelText('2 alertas de fadiga')).toBeTruthy()
  })

  it('sem ninguém em fadiga, o badge some em vez de mostrar zero', async () => {
    alertUsersMock.mockResolvedValue({
      data: [pessoa('u-exc-1', 'Excelente Um', 'excelente')],
      error: null,
    })
    await renderAt('/monitoring/good-conditions')

    expect(screen.queryByLabelText(/alertas de fadiga/)).toBeNull()
  })

  it('sem tier declarado, o tom do alerta decide em que aba a pessoa cai', async () => {
    // O seed mock não simula vitais, então `tier` pode vir vazio: o tom do
    // alerta é o que resta para classificar.
    const semTier = (id: string, name: string, tone: 'error' | 'warning' | null) => ({
      ...pessoa(id, name, 'excelente'),
      tier: undefined,
      alerts: tone
        ? [
            {
              id: `${id}-a`,
              icon: 'heart_filled' as const,
              title: 'Sinal fora da faixa',
              description: 'detalhe',
              tone,
            },
          ]
        : [],
    })
    alertUsersMock.mockResolvedValue({
      data: [
        semTier('u-1', 'Sem Tier Crítico', 'error'),
        semTier('u-2', 'Sem Tier Alerta', 'warning'),
        semTier('u-3', 'Sem Tier Limpo', null),
      ],
      error: null,
    })

    await renderAt('/monitoring/alerts')
    expect(screen.getByText('Sem Tier Crítico')).toBeTruthy()
    expect(screen.queryByText('Sem Tier Alerta')).toBeNull()
    expect(screen.queryByText('Sem Tier Limpo')).toBeNull()
  })

  it('nenhum card abre sozinho fora da aba de fadiga', async () => {
    await renderAt('/monitoring/desgastados')

    expect(screen.queryByRole('button', { name: 'Ver histórico de exames clínicos' })).toBeNull()
  })

  it('recolher e reabrir o card alterna o detalhe do alerta', async () => {
    await renderAt('/monitoring/alerts')
    expect(screen.getAllByText('Frequência cardíaca crítica')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /recolher alertas de fadiga um/i }))
    await act(async () => {})
    expect(screen.queryByText('Frequência cardíaca crítica')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /expandir alertas de fadiga um/i }))
    await act(async () => {})
    expect(screen.getAllByText('Frequência cardíaca crítica')).toHaveLength(1)
  })

  it('expandir um card recolhe o que estava aberto', async () => {
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByRole('button', { name: /expandir alertas de fadiga dois/i }))
    await act(async () => {})

    expect(screen.getAllByText('Frequência cardíaca crítica')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /recolher alertas de fadiga um/i })).toBeNull()
  })

  it('o pino do card leva ao mapa geral e a lupa de exames ao funcionário', async () => {
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByRole('button', { name: /localização de fadiga um/i }))
    expect(nav.spy).toHaveBeenCalledWith('/maps/general')

    fireEvent.click(screen.getByRole('button', { name: 'Ver histórico de exames clínicos' }))
    expect(nav.spy).toHaveBeenCalledWith('/employees/u-fad-1')
  })

  it('trocar de aba pela régua navega para a rota correspondente', async () => {
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByText('Desgastados'))

    expect(nav.spy).toHaveBeenCalledWith('/monitoring/desgastados')
  })

  it('clicar na aba já ativa não renavega', async () => {
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByText('Alertas de Fadiga'))

    expect(nav.spy).not.toHaveBeenCalledWith('/monitoring/alerts')
  })

  it('rota desconhecida cai na aba de alertas', async () => {
    await renderAt('/monitoring')

    expect(nomesVisiveis()).toEqual(['Fadiga Um', 'Fadiga Dois'])
  })

  it('a lista sobrevive a um retorno vazio da API', async () => {
    kpisMock.mockResolvedValue({ data: null, error: { message: 'falhou' } as never })
    alertUsersMock.mockResolvedValue({ data: null, error: { message: 'falhou' } as never })

    await renderAt('/monitoring/alerts')

    expect(screen.getByTestId('monitoring-layout')).toBeTruthy()
    expect(nomesVisiveis()).toEqual([])
  })
})
