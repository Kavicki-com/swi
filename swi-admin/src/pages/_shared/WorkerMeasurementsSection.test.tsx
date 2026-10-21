// A faixa "Medições do relógio" só desenha o que a view decidiu: a frase de
// ausência quando não há leitura, e uma rosca por medição quando há, depois
// das roscas de fadiga e esforço. Valor ausente vira NO_VALUE, nunca um zero
// inventado.
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
    centerLabel: 'Saturação',
    icon: 'water_drop',
    value: '97%',
    caption: 'Última medição às 14:59',
    progress: 97,
  },
  {
    key: 'temperature',
    label: 'Temperatura',
    centerLabel: 'Corporal',
    icon: 'device_thermostat',
    value: '36,5 °C',
    caption: 'Última medição às 14:59',
    progress: 100,
  },
  {
    key: 'steps',
    label: 'Passos',
    centerLabel: 'Passos dados',
    icon: 'footprint',
    value: '4.230',
    caption: 'Hoje',
    progress: 100,
  },
  {
    key: 'distance',
    label: 'Distância',
    centerLabel: 'Percorrida',
    icon: 'directions_walk',
    value: '3,1 km',
    caption: 'Hoje',
    progress: 100,
  },
  {
    key: 'movement',
    label: 'Movimento',
    centerLabel: 'Ritmo atual',
    icon: 'health_activity',
    value: '42/min',
    caption: 'Última amostra às 14:59',
    progress: 100,
  },
  {
    key: 'resting',
    label: 'Repouso',
    centerLabel: 'Batimento',
    icon: 'favorite',
    value: '62 bpm',
    caption: 'Medido em 9 dias',
    progress: 100,
  },
  {
    key: 'max',
    label: 'Máxima',
    centerLabel: 'Batimento',
    icon: 'heartbeat',
    value: '181 bpm',
    caption: 'Estimada pela idade',
    progress: 100,
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

const EMPTY: WorkerMeasurementsView = { kind: 'empty', message: NO_DEVICE_LABEL }

/** ENTRIES com a medição `key` trocada por `over`. */
const replacing = (key: MeasurementEntry['key'], over: Partial<MeasurementEntry>) =>
  ENTRIES.map((e): MeasurementEntry => (e.key === key ? { ...e, ...over } : e))

// Os rótulos das roscas vêm decididos pelo vitalsView: ao vivo são os padrão,
// com a pulseira trazem o instante medido.
const renderSection = (
  view: WorkerMeasurementsView = entries(),
  wearPct: number | null = 38.4,
  effortPct: number | null = 61,
  labels: { wearLabel: string; effortLabel: string } = {
    wearLabel: 'Fadiga atual',
    effortLabel: 'Esforço feito',
  },
) =>
  renderPage(
    <WorkerMeasurementsSection
      view={view}
      wearPct={wearPct}
      effortPct={effortPct}
      wearLabel={labels.wearLabel}
      effortLabel={labels.effortLabel}
    />,
  )

describe('WorkerMeasurementsSection', () => {
  it('mostra o título da faixa', async () => {
    await renderSection()
    expect(screen.getByRole('heading', { name: 'Medições do relógio' })).toBeInTheDocument()
  })

  it('sem leitura mostra a frase de ausência e nenhuma rosca', async () => {
    await renderSection(EMPTY, null, null)
    expect(screen.getByTestId('measurements-empty')).toHaveTextContent(NO_DEVICE_LABEL)
    expect(screen.queryByTestId(/^measurement-/)).not.toBeInTheDocument()
    expect(screen.queryByText('Taxa de fadiga')).not.toBeInTheDocument()
  })

  it('com leitura mostra fadiga, esforço e as sete medições lado a lado, nessa ordem', async () => {
    await renderSection()
    const donuts = screen.getAllByTestId(/^measurement-[a-z]+$/)
    expect(donuts.map((donut) => donut.getAttribute('data-testid'))).toEqual([
      'measurement-wear',
      'measurement-effort',
      ...ENTRIES.map((entry) => `measurement-${entry.key}`),
    ])
    // Todas na mesma fileira, que quebra linha quando a tela estreita.
    const row = donuts[0]?.parentElement
    expect(row).toBeTruthy()
    expect(donuts.every((donut) => donut.parentElement === row)).toBe(true)
  })

  it('cada medição mostra título, valor, rótulo central e legenda dentro da rosca', async () => {
    await renderSection()
    for (const entry of ENTRIES) {
      const donut = within(screen.getByTestId(`measurement-${entry.key}`))
      expect(donut.getByText(entry.label)).toBeInTheDocument()
      expect(donut.getByText(entry.value)).toBeInTheDocument()
      expect(donut.getByText(entry.centerLabel)).toBeInTheDocument()
      expect(donut.getByText(entry.caption)).toBeInTheDocument()
    }
  })

  // Desgaste e esforço vêm em 0-100 do backend. Multiplicar por 100 de novo na
  // formatação exibiria "3.840,0%".
  it('fadiga e esforço em porcentagem com uma casa, sem multiplicar de novo', async () => {
    await renderSection()
    const wear = within(screen.getByTestId('measurement-wear'))
    expect(wear.getByText('Taxa de fadiga')).toBeInTheDocument()
    expect(wear.getByText('38,4%')).toBeInTheDocument()
    expect(wear.getByText('Fadiga atual')).toBeInTheDocument()
    const effort = within(screen.getByTestId('measurement-effort'))
    expect(effort.getByText('Esforço realizado')).toBeInTheDocument()
    expect(effort.getByText('61,0%')).toBeInTheDocument()
    expect(effort.getByText('Esforço feito')).toBeInTheDocument()
  })

  // Com a pulseira o valor é do instante medido, não de agora: a rosca mostra
  // o rótulo que o vitalsView decidiu, em vez do texto fixo "atual".
  it('fadiga e esforço usam os rótulos recebidos, com o instante medido', async () => {
    await renderSection(entries(), 38.4, 61, {
      wearLabel: 'Fadiga às 14:10',
      effortLabel: 'Esforço feito em 30/09 às 14:10',
    })
    expect(
      within(screen.getByTestId('measurement-wear')).getByText('Fadiga às 14:10'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('measurement-effort')).getByText('Esforço feito em 30/09 às 14:10'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Fadiga atual')).not.toBeInTheDocument()
    expect(screen.queryByText('Esforço feito')).not.toBeInTheDocument()
  })

  it('fadiga e esforço sem valor mostram NO_VALUE em vez de 0%', async () => {
    await renderSection(entries(), null, null)
    expect(within(screen.getByTestId('measurement-wear')).getByText(NO_VALUE)).toBeInTheDocument()
    expect(within(screen.getByTestId('measurement-effort')).getByText(NO_VALUE)).toBeInTheDocument()
    expect(screen.queryByText('0,0%')).not.toBeInTheDocument()
  })

  it('valor ausente vira NO_VALUE em vez de zero', async () => {
    await renderSection(entries(replacing('oxygen', { value: null, caption: null, progress: 0 })))
    expect(within(screen.getByTestId('measurement-oxygen')).getByText(NO_VALUE)).toBeInTheDocument()
  })

  it('valor ausente com legenda mostra NO_VALUE e ainda a legenda', async () => {
    await renderSection(
      entries(
        replacing('movement', {
          value: null,
          caption: 'Última amostra em 30/09 às 18:02',
          progress: 0,
        }),
      ),
    )
    const movement = within(screen.getByTestId('measurement-movement'))
    expect(movement.getByText(NO_VALUE)).toBeInTheDocument()
    expect(movement.getByText('Última amostra em 30/09 às 18:02')).toBeInTheDocument()
  })

  it('legenda ausente não desenha linha abaixo da rosca', async () => {
    await renderSection(entries(replacing('movement', { caption: null })))
    const movement = screen.getByTestId('measurement-movement')
    expect(movement).toBeInTheDocument()
    expect(within(movement).queryByText(/Última amostra/)).not.toBeInTheDocument()
  })

  it('leitura de demonstração leva o selo de origem', async () => {
    await renderSection(entries(ENTRIES, DEMO_DATA_LABEL))
    expect(screen.getByTestId('measurements-source-badge')).toHaveTextContent(DEMO_DATA_LABEL)
  })

  it('leitura real e frase de ausência não levam selo', async () => {
    const { unmount } = await renderSection()
    expect(screen.queryByTestId('measurements-source-badge')).not.toBeInTheDocument()
    unmount()
    await renderSection(EMPTY, null, null)
    expect(screen.queryByTestId('measurements-source-badge')).not.toBeInTheDocument()
  })
})
