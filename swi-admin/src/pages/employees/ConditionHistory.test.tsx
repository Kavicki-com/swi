// Histórico de condições no perfil do funcionário: o motivo de cada
// fechamento, os três instantes do episódio atrasado e o rótulo dos episódios
// repetidos. A API e o socket são dublês; o que estes casos protegem é o que o
// gestor lê. describe/it/expect/afterEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { ConditionHistory } from './ConditionHistory'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import {
  telemetryApi,
  type ConditionHistoryItem,
  type ConditionHistoryPage,
} from '@/services/api/telemetry'
import { subscribeTelemetryEvents } from '@/services/telemetry/telemetrySocket'

vi.mock('@/services/api/telemetry', () => ({
  telemetryApi: { workerConditions: vi.fn() },
}))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: vi.fn(() => () => {}),
}))

const conditionsMock = vi.mocked(telemetryApi.workerConditions)
const subscribeMock = vi.mocked(subscribeTelemetryEvents)

/** Hoje, na hora local dada, para a legenda sair só com a hora. */
const today = (h: number, m: number): string => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

/** Ontem, na hora local dada, para a legenda levar a data. */
const yesterday = (h: number, m: number): string => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const dayOf = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

const item = (over: Partial<ConditionHistoryItem> = {}): ConditionHistoryItem => ({
  id: 'c1',
  origin: 'REAL',
  kind: 'BLOOD_PRESSURE_FATIGUE',
  category: 'HEALTH',
  status: 'RECOVERED',
  openedAt: today(8, 0),
  recoveredAt: today(9, 0),
  recoveryReason: 'NORMALIZED',
  observedValue: 152,
  thresholdValue: 140,
  receivedAt: null,
  episodeKind: null,
  ...over,
})

const page = (
  items: ConditionHistoryItem[],
  nextCursor: string | null = null,
): { data: ConditionHistoryPage; error: null } => ({ data: { items, nextCursor }, error: null })

const mount = async (items: ConditionHistoryItem[], nextCursor: string | null = null) => {
  conditionsMock.mockResolvedValue(page(items, nextCursor))
  await renderPage(<ConditionHistory workerId="w1" />)
  await screen.findByTestId('condition-history')
}

const row = (id: string) => within(screen.getByTestId(`condition-history-item-${id}`))

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('ConditionHistory: motivo do fechamento', () => {
  it.each([
    ['NORMALIZED', 'Normalizada'],
    ['SIGNAL_LOST', 'Por silêncio'],
    ['SIGNAL_RESTORED', 'Sinal restabelecido'],
    ['NO_NEW_READING', 'Encerrada sem leitura nova'],
    ['PROFILE_RETIRED', 'Regra substituída pela calibração'],
  ] as const)('%s aparece como "%s", com a abertura e o fechamento', async (reason, label) => {
    await mount([item({ recoveryReason: reason })])
    expect(row('c1').getByText(label)).toBeTruthy()
    expect(row('c1').getByText('Aberta às 08:00')).toBeTruthy()
    expect(row('c1').getByText('Encerrada às 09:00')).toBeTruthy()
  })

  it('os quatro motivos lado a lado nunca se confundem', async () => {
    await mount([
      item({ id: 'a', recoveryReason: 'NORMALIZED' }),
      item({ id: 'b', recoveryReason: 'SIGNAL_LOST' }),
      item({ id: 'c', recoveryReason: 'SIGNAL_RESTORED' }),
      item({ id: 'd', recoveryReason: 'NO_NEW_READING' }),
    ])
    expect(row('a').queryByText('Encerrada sem leitura nova')).toBeNull()
    expect(row('d').queryByText('Normalizada')).toBeNull()
    expect(row('b').queryByText('Normalizada')).toBeNull()
    expect(row('c').getByText('Sinal restabelecido')).toBeTruthy()
  })

  it('fechada sem motivo gravado diz só que encerrou', async () => {
    await mount([item({ recoveryReason: null })])
    expect(row('c1').getByText('Encerrada')).toBeTruthy()
    expect(row('c1').queryByText('Normalizada')).toBeNull()
  })

  it('condição aberta diz "Aberta" e não tem fechamento', async () => {
    await mount([item({ status: 'ACTIVE', recoveredAt: null, recoveryReason: null })])
    expect(row('c1').getByText('Aberta')).toBeTruthy()
    expect(row('c1').queryByText(/^Encerrada/)).toBeNull()
  })

  it('título e frase do tipo, com a categoria; condição de outro dia leva a data', async () => {
    const opened = yesterday(14, 20)
    const recovered = yesterday(15, 0)
    await mount([item({ openedAt: opened, recoveredAt: recovered })])
    expect(screen.getByText('Histórico de condições')).toBeTruthy()
    expect(row('c1').getByText('Pressão na faixa de fadiga')).toBeTruthy()
    expect(row('c1').getByText('Sistólica 152, faixa a partir de 140')).toBeTruthy()
    expect(row('c1').getByText('Atenção')).toBeTruthy()
    expect(row('c1').getByText(`Aberta em ${dayOf(opened)} às 14:20`)).toBeTruthy()
    expect(row('c1').getByText(`Encerrada em ${dayOf(recovered)} às 15:00`)).toBeTruthy()
  })

  it('condição do aparelho também entra, com a categoria Aparelho', async () => {
    await mount([
      item({
        kind: 'DEVICE_SIGNAL_LOST',
        category: 'DEVICE',
        recoveryReason: 'SIGNAL_RESTORED',
        observedValue: null,
        thresholdValue: null,
      }),
    ])
    expect(row('c1').getByText('Sem sinal do relógio')).toBeTruthy()
    expect(row('c1').getByText('Aparelho')).toBeTruthy()
    expect(row('c1').getByText('Sinal restabelecido')).toBeTruthy()
  })

  it('origem de demonstração leva a nota', async () => {
    await mount([item({ origin: 'DEMO' })])
    expect(row('c1').getByText('Dados de demonstração')).toBeTruthy()
  })
})

describe('ConditionHistory: episódio atrasado', () => {
  it('mostra medido, encerrado e recebido, com a data quando é de outro dia', async () => {
    const measured = yesterday(23, 10)
    const closed = yesterday(23, 40)
    await mount([
      item({
        kind: 'HEART_RATE_HIGH',
        category: 'URGENT',
        openedAt: measured,
        recoveredAt: closed,
        receivedAt: today(8, 5),
        observedValue: 181,
        thresholdValue: 167,
      }),
    ])
    expect(row('c1').getByText('Urgente, episódio atrasado')).toBeTruthy()
    expect(row('c1').getByText(`Medido em ${dayOf(measured)} às 23:10`)).toBeTruthy()
    expect(row('c1').getByText(`Encerrado em ${dayOf(closed)} às 23:40`)).toBeTruthy()
    expect(row('c1').getByText('Recebido às 08:05')).toBeTruthy()
    expect(row('c1').getByText('Normalizada')).toBeTruthy()
    expect(row('c1').queryByText(/^Aberta/)).toBeNull()
  })

  it('do mesmo dia, os três instantes saem só com a hora', async () => {
    await mount([
      item({ openedAt: today(7, 0), recoveredAt: today(7, 20), receivedAt: today(9, 45) }),
    ])
    expect(row('c1').getByText('Medido às 07:00')).toBeTruthy()
    expect(row('c1').getByText('Encerrado às 07:20')).toBeTruthy()
    expect(row('c1').getByText('Recebido às 09:45')).toBeTruthy()
  })
})

describe('ConditionHistory: episódios repetidos', () => {
  it('rótulo com o tipo original, a contagem e os instantes do terceiro, sem motivo', async () => {
    await mount([
      item({
        kind: 'REPEATED_EPISODES',
        category: 'HEALTH',
        episodeKind: 'HEART_RATE_HIGH',
        observedValue: 3,
        thresholdValue: 3,
        openedAt: today(6, 30),
        recoveredAt: today(6, 30),
        receivedAt: today(8, 5),
      }),
    ])
    expect(row('c1').getByText('Episódios repetidos de frequência cardíaca alta')).toBeTruthy()
    expect(
      row('c1').getByText('3 episódios no mesmo dia, já encerrados quando a pulseira sincronizou'),
    ).toBeTruthy()
    expect(row('c1').getByText('Atenção')).toBeTruthy()
    expect(row('c1').getByText('Terceiro episódio medido às 06:30')).toBeTruthy()
    expect(row('c1').getByText('Recebido às 08:05')).toBeTruthy()
    expect(row('c1').queryByText('Normalizada')).toBeNull()
    expect(row('c1').queryByText(/episódio atrasado/)).toBeNull()
  })
})

describe('ConditionHistory: carga', () => {
  it('pede o histórico do funcionário', async () => {
    await mount([item()])
    expect(conditionsMock).toHaveBeenCalledWith('w1')
  })

  it('sem condição nenhuma diz isso', async () => {
    conditionsMock.mockResolvedValue(page([]))
    await renderPage(<ConditionHistory workerId="w1" />)
    expect(await screen.findByText('Nenhuma condição registrada.')).toBeTruthy()
  })

  it('falha diz que não carregou e tenta de novo', async () => {
    conditionsMock.mockResolvedValueOnce({ data: null, error: { message: 'fora do ar' } })
    conditionsMock.mockResolvedValue(page([item()]))
    await renderPage(<ConditionHistory workerId="w1" />)
    expect(await screen.findByText('Não foi possível carregar o histórico.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Tentar carregar o histórico de novo'))
    expect(await screen.findByTestId('condition-history-item-c1')).toBeTruthy()
  })

  it('"Carregar mais" pede a página seguinte pelo cursor e acrescenta', async () => {
    await mount([item({ id: 'c1' })], 'c1')
    conditionsMock.mockResolvedValueOnce(page([item({ id: 'c2', recoveryReason: 'SIGNAL_LOST' })]))
    fireEvent.click(screen.getByLabelText('Carregar mais condições'))
    expect(await screen.findByTestId('condition-history-item-c2')).toBeTruthy()
    expect(conditionsMock).toHaveBeenLastCalledWith('w1', 'c1')
    expect(screen.getByTestId('condition-history-item-c1')).toBeTruthy()
    expect(screen.queryByLabelText('Carregar mais condições')).toBeNull()
  })

  it('condição nova deste funcionário relê o histórico; de outro, não', async () => {
    await mount([item({ id: 'c1' })])
    const handlers = subscribeMock.mock.lastCall?.[0]
    expect(handlers).toBeDefined()
    conditionsMock.mockResolvedValue(page([item({ id: 'c9' }), item({ id: 'c1' })]))
    await act(async () => {
      handlers?.onCondition({ workerId: 'outro' } as never)
    })
    expect(conditionsMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      handlers?.onCondition({ workerId: 'w1' } as never)
    })
    expect(await screen.findByTestId('condition-history-item-c9')).toBeTruthy()
  })
})
