// Estes testes protegem uma invariante do detalhe de funcionário/admin: a tela
// nunca mostra número ou rótulo CONFIANTE que não corresponda a dado real.
// Onde o dado falta, ela declara a ausência em vez de preencher com um default.
// vitest globals (describe/it/expect) via globals: true.
import { vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderPage } from '@/test-utils/renderPage'
import { emptyPoint, series } from '@/test-utils/telemetryFixtures'

const seriesMock = vi.fn()

vi.mock('@/services/api/telemetry', () => ({
  telemetryApi: { workerSeries: (...args: unknown[]) => seriesMock(...args) },
}))

const withKcal = (kcal: number | null) =>
  series(
    [
      {
        ...emptyPoint('2026-10-01T11:00:00.000Z', '2026-10-01T12:00:00.000Z'),
        activeEnergyKcal: kcal,
      },
    ],
    {
      bucket: 'hour',
      period: 'day',
    },
  )
import { vitalsViewFrom, type WorkerVitalsView } from '@/services/vitals/vitalsView'
import { WorkerDetailsLayout, type WorkerDetailsData } from './WorkerDetailsLayout'

const BASE: WorkerDetailsData = {
  name: 'Fulano de Teste',
  age: 43,
  bloodType: 'B+',
  role: 'Operador',
  specialization: 'Setor Leste',
  avatarUri: '',
  vitals: vitalsViewFrom(null),
}

const READING: WorkerVitalsView = {
  heartRate: '112',
  pressure: '128/82',
  wearPct: 89,
  effortPct: 92,
  fatigueEta: { minutes: 95, label: '95 minutos' },
  status: 'Monitorando agora',
  sourceBadge: null,
}

const renderLayout = async (
  worker: Partial<WorkerDetailsData>,
  position: { lat: number; lng: number } | null = { lat: -23.55, lng: -46.63 },
) =>
  await renderPage(
    <WorkerDetailsLayout
      worker={{ ...BASE, ...worker }}
      position={position}
      testID="worker-details"
      onBack={() => {}}
      backA11yLabel="Voltar"
      onOpenFullMap={() => {}}
      topRightAction={null}
    />,
    { route: '/employees/w1', path: '/employees/:id' },
  )

describe('WorkerDetailsLayout', () => {
  // Desgaste e esforço vêm em 0-100 do backend. Multiplicar por 100 de novo na
  // formatação exibiria "8.900,0%".
  it('formata fadiga/esforço na escala 0-100, sem multiplicar de novo', async () => {
    await renderLayout({ vitals: READING })
    expect(screen.getByText('89,0%')).toBeInTheDocument()
    expect(screen.getByText('92,0%')).toBeInTheDocument()
    expect(screen.queryByText('8.900,0%')).not.toBeInTheDocument()
  })

  it('mostra a leitura do aparelho: batimento, pressão, estado e tempo até a fadiga', async () => {
    await renderLayout({ vitals: READING })
    expect(screen.getByText(/^112\s*$/)).toBeInTheDocument()
    expect(screen.getByText('128/82')).toBeInTheDocument()
    expect(screen.getByText('Monitorando agora')).toBeInTheDocument()
    expect(screen.getByText('95 minutos')).toBeInTheDocument()
  })

  it('sem leitura, declara a ausência em vez de mostrar 0', async () => {
    await renderLayout({})
    expect(screen.getByText('Sem leitura do aparelho')).toBeInTheDocument()
    expect(screen.getByText('Sem estimativa')).toBeInTheDocument()
    expect(screen.queryByText(/^0\s*$/)).not.toBeInTheDocument()
    expect(screen.queryByText('0 minutos')).not.toBeInTheDocument()
    expect(screen.queryByText('0,0%')).not.toBeInTheDocument()
    // Nenhum juízo de saúde sem condição do backend que o sustente.
    expect(screen.queryByText('Condições excelentes')).not.toBeInTheDocument()
  })

  it('leitura de demonstração leva o selo de demonstração', async () => {
    await renderLayout({ vitals: { ...READING, sourceBadge: 'Dados de demonstração' } })
    expect(screen.getByText('Dados de demonstração')).toBeInTheDocument()
  })

  describe('gasto calórico por período', () => {
    beforeEach(() => {
      seriesMock.mockReset()
    })

    // A curva sai da série do backend: nada no detalhe é simulado.
    it('lê a série de hoje do funcionário e não exibe selo de simulação', async () => {
      seriesMock.mockResolvedValue({ data: withKcal(62), error: null })
      await renderLayout({ vitals: READING, seriesWorkerId: 'w1' })
      expect(seriesMock).toHaveBeenCalledWith('w1', 'day')
      expect(await screen.findByTestId('calories-chart')).toBeInTheDocument()
      expect(screen.queryByTestId('simulated-data-badge')).not.toBeInTheDocument()
    })

    it('período sem medição declara a ausência em vez de desenhar zeros', async () => {
      seriesMock.mockResolvedValue({ data: withKcal(null), error: null })
      await renderLayout({ vitals: READING, seriesWorkerId: 'w1' })
      expect(await screen.findByText('Sem medição neste período')).toBeInTheDocument()
      expect(screen.queryByTestId('calories-chart')).not.toBeInTheDocument()
    })

    it('falha na leitura diz que está indisponível', async () => {
      seriesMock.mockResolvedValue({ data: null, error: { message: 'offline' } })
      await renderLayout({ vitals: READING, seriesWorkerId: 'w1' })
      expect(await screen.findByText('Gasto calórico indisponível no momento')).toBeInTheDocument()
    })

    // Administrador não pareia aparelho: curva ali seria inventada.
    it('sem funcionário com aparelho não busca série e diz que não há aparelho', async () => {
      await renderLayout({ vitals: READING })
      expect(seriesMock).not.toHaveBeenCalled()
      expect(screen.getByTestId('calories-empty')).toHaveTextContent('Sem aparelho')
    })
  })

  // Sem gênero cadastrado a tela não pode eleger "Feminino" como default.
  it('não inventa gênero quando o cadastro não tem o campo', async () => {
    await renderLayout({})
    expect(screen.getByText('Não informado')).toBeInTheDocument()
    expect(screen.queryByText('Feminino')).not.toBeInTheDocument()
  })

  it('mostra o gênero real quando cadastrado', async () => {
    await renderLayout({ gender: 'male' })
    expect(screen.getByText('Masculino')).toBeInTheDocument()
  })

  // Quem se declarou não-binário ou "outro" no cadastro é gravado como 'other'.
  // Cair em "Não informado" apagaria uma declaração que a pessoa FEZ, e a
  // deixaria indistinguível de quem preferiu não responder.
  it('mostra "Outro" para o gênero declarado fora do binário', async () => {
    await renderLayout({ gender: 'other' })
    expect(screen.getByText('Outro')).toBeInTheDocument()
    expect(screen.queryByText('Não informado')).not.toBeInTheDocument()
  })

  // Título sozinho lê como falha de carregamento; o estado vazio é informação.
  // Handle do "Nome do usuário": aparece sob o nome quando existe, e NÃO
  // aparece quando não existe. Um @ vazio ou inventado afirmaria identidade
  // que a conta não tem.
  it('mostra o @handle quando a conta tem um', async () => {
    await renderLayout({ username: 'carlos.m' })
    expect(screen.getByText('@carlos.m')).toBeInTheDocument()
  })

  it('sem handle, nenhum @ é renderizado', async () => {
    await renderLayout({})
    expect(screen.queryByText(/^@/)).toBeNull()
  })

  it('declara os vazios de alergias e exames em vez de deixar a seção muda', async () => {
    await renderLayout({})
    expect(screen.getByText('Nenhuma alergia registrada.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum exame registrado.')).toBeInTheDocument()
  })

  it('pinta uma chip por alergia quando existem', async () => {
    await renderLayout({ allergies: ['Penicilina', 'Látex'] })
    expect(screen.getByText('Penicilina')).toBeInTheDocument()
    expect(screen.getByText('Látex')).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma alergia registrada.')).not.toBeInTheDocument()
  })

  // Sem posição ao vivo o mini-mapa NÃO pina numa coordenada default, que
  // seria a mesma pra todo funcionário do quadro.
  it('declara a ausência de posição em vez de pinar num ponto fixo', async () => {
    await renderLayout({}, null)
    expect(screen.getByText('Sem posição ao vivo')).toBeInTheDocument()
  })
})
