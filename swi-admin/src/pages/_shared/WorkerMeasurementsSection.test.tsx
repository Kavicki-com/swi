// A faixa "Medições do relógio" só desenha o que a view decidiu: a frase de
// ausência quando não há leitura, e um card por medição quando há. Valor
// ausente vira NO_VALUE, nunca um zero inventado.
// vitest globals (describe/it/expect) via globals: true.
import { screen, within } from '@testing-library/react'
import { renderPage } from '@/test-utils/renderPage'
import type { MeasurementEntry, WorkerMeasurementsView } from '@/services/vitals/measurementsView'
import { DEMO_DATA_LABEL, NO_DEVICE_LABEL, NO_VALUE } from '@/services/vitals/vitalsView'
import { WorkerMeasurementsSection } from './WorkerMeasurementsSection'

// Leitura completa: toda medição com valor e legenda, na ordem do measurementsView.
type FullEntry = MeasurementEntry & { value: string; caption: string }

const ENTRIES: FullEntry[] = [
  {
    key: 'oxygen',
    label: 'Oxigenação',
    icon: 'water_drop',
    value: '97%',
    caption: 'Última medição às 14:59',
  },
  {
    key: 'temperature',
    label: 'Temperatura',
    icon: 'device_thermostat',
    value: '36,5 °C',
    caption: 'Última medição às 14:59',
  },
  { key: 'steps', label: 'Passos', icon: 'footprint', value: '4.230', caption: 'Hoje' },
  {
    key: 'distance',
    label: 'Distância',
    icon: 'directions_walk',
    value: '3,1 km',
    caption: 'Hoje',
  },
  {
    key: 'movement',
    label: 'Movimento',
    icon: 'health_activity',
    value: '42/min',
    caption: 'Última amostra às 14:59',
  },
  {
    key: 'resting',
    label: 'Repouso',
    icon: 'favorite',
    value: '62 bpm',
    caption: 'Medido em 9 dias',
  },
  {
    key: 'max',
    label: 'Máxima',
    icon: 'heartbeat',
    value: '181 bpm',
    caption: 'Estimada pela idade',
  },
]

const entries = (
  list: MeasurementEntry[] = ENTRIES,
  sourceBadge: string | null = null,
): WorkerMeasurementsView => ({
  kind: 'entries',
  entries: list,
  sourceBadge,
})

/** ENTRIES com a medição `key` trocada por `over`. */
const replacing = (key: MeasurementEntry['key'], over: Partial<MeasurementEntry>) =>
  ENTRIES.map((e): MeasurementEntry => (e.key === key ? { ...e, ...over } : e))

describe('WorkerMeasurementsSection', () => {
  it('mostra o título da faixa', async () => {
    await renderPage(<WorkerMeasurementsSection view={entries()} />)
    expect(screen.getByRole('heading', { name: 'Medições do relógio' })).toBeInTheDocument()
  })

  it('sem leitura mostra a frase de ausência e nenhum card', async () => {
    await renderPage(
      <WorkerMeasurementsSection view={{ kind: 'empty', message: NO_DEVICE_LABEL }} />,
    )
    expect(screen.getByTestId('measurements-empty')).toHaveTextContent(NO_DEVICE_LABEL)
    expect(screen.queryByTestId(/^measurement-/)).not.toBeInTheDocument()
  })

  it('com leitura mostra os sete cards na ordem, cada um com valor, rótulo e legenda', async () => {
    await renderPage(<WorkerMeasurementsSection view={entries()} />)
    const cards = screen.getAllByTestId(/^measurement-[a-z]+$/)
    expect(cards.map((card) => card.getAttribute('data-testid'))).toEqual(
      ENTRIES.map((entry) => `measurement-${entry.key}`),
    )
    for (const entry of ENTRIES) {
      const card = within(screen.getByTestId(`measurement-${entry.key}`))
      expect(card.getByText(entry.value)).toBeInTheDocument()
      expect(card.getByText(entry.label)).toBeInTheDocument()
      expect(screen.getByTestId(`measurement-${entry.key}-caption`)).toHaveTextContent(
        entry.caption,
      )
    }
  })

  it('valor ausente vira NO_VALUE em vez de zero', async () => {
    await renderPage(
      <WorkerMeasurementsSection
        view={entries(replacing('oxygen', { value: null, caption: null }))}
      />,
    )
    expect(within(screen.getByTestId('measurement-oxygen')).getByText(NO_VALUE)).toBeInTheDocument()
  })

  it('valor ausente com legenda mostra NO_VALUE e ainda a legenda', async () => {
    await renderPage(
      <WorkerMeasurementsSection
        view={entries(
          replacing('movement', { value: null, caption: 'Última amostra em 30/09 às 18:02' }),
        )}
      />,
    )
    expect(
      within(screen.getByTestId('measurement-movement')).getByText(NO_VALUE),
    ).toBeInTheDocument()
    expect(screen.getByTestId('measurement-movement-caption')).toHaveTextContent(
      'Última amostra em 30/09 às 18:02',
    )
  })

  it('leitura de demonstração leva o selo de origem', async () => {
    await renderPage(<WorkerMeasurementsSection view={entries(ENTRIES, DEMO_DATA_LABEL)} />)
    expect(screen.getByTestId('measurements-source-badge')).toHaveTextContent(DEMO_DATA_LABEL)
  })

  it('leitura real e frase de ausência não levam selo', async () => {
    const { unmount } = await renderPage(<WorkerMeasurementsSection view={entries()} />)
    expect(screen.queryByTestId('measurements-source-badge')).not.toBeInTheDocument()
    unmount()
    await renderPage(
      <WorkerMeasurementsSection view={{ kind: 'empty', message: NO_DEVICE_LABEL }} />,
    )
    expect(screen.queryByTestId('measurements-source-badge')).not.toBeInTheDocument()
  })

  it('legenda ausente não desenha a linha abaixo do card', async () => {
    await renderPage(
      <WorkerMeasurementsSection view={entries(replacing('movement', { caption: null }))} />,
    )
    expect(screen.getByTestId('measurement-movement')).toBeInTheDocument()
    expect(screen.queryByTestId('measurement-movement-caption')).not.toBeInTheDocument()
  })
})
