// describe/it/expect/vi vêm dos globals do Vitest.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { calibrationApi, type CalibrationHistoryItem } from '@/services/api/calibration'
import { whenLabel } from '@/lib/whenLabel'
import { CalibrationHistoryTab } from './CalibrationHistoryTab'

vi.mock('@/services/api/calibration', () => ({ calibrationApi: { history: vi.fn() } }))

const historyMock = vi.mocked(calibrationApi.history)

const item = (over: Partial<CalibrationHistoryItem>): CalibrationHistoryItem => ({
  id: 'h1',
  action: 'BAND_OVERRIDE',
  metric: 'HEART_RATE',
  rule: null,
  from: null,
  to: { excellence: 110, fatigue: 140 },
  actor: { id: 'u1', name: 'Ana Gestora' },
  at: '2026-10-20T14:32:00.000Z',
  ...over,
})

afterEach(() => {
  clearSession()
  historyMock.mockReset()
})

describe('CalibrationHistoryTab', () => {
  it('lista quem, quando, a ação e de onde para onde', async () => {
    historyMock.mockResolvedValue({
      data: {
        items: [
          item({}),
          item({
            id: 'h2',
            action: 'RECALIBRATE_DEVICE',
            metric: null,
            from: { deviceFamily: 'WATCH' },
            to: { deviceFamily: 'BAND' },
            actor: null,
          }),
        ],
        nextCursor: null,
      },
      error: null,
    })
    await renderPage(<CalibrationHistoryTab workerId="w1" />)

    const first = await screen.findByTestId('history-item-h1')
    expect(first).toHaveTextContent('Faixa corrigida: Batimento cardíaco')
    expect(first).toHaveTextContent('Ana Gestora')
    expect(first).toHaveTextContent(whenLabel('2026-10-20T14:32:00.000Z', Date.now()) ?? '')
    expect(first).toHaveTextContent('De: aprendido')
    expect(first).toHaveTextContent('Para: excelência até 110, fadiga a partir de 140')

    const second = screen.getByTestId('history-item-h2')
    expect(second).toHaveTextContent('Recalibração por troca de aparelho')
    expect(second).toHaveTextContent('Sistema')
    expect(second).toHaveTextContent('De: Relógio')
    expect(second).toHaveTextContent('Para: Pulseira')
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
    expect(historyMock).toHaveBeenCalledWith('w1')
  })

  it('carrega mais pelo cursor e junta no fim', async () => {
    const reverted = item({
      id: 'h3',
      action: 'BAND_REVERT',
      from: { excellence: 110, fatigue: 140 },
      to: null,
    })
    historyMock
      .mockResolvedValueOnce({ data: { items: [item({})], nextCursor: 'c-2' }, error: null })
      .mockResolvedValueOnce({ data: { items: [reverted], nextCursor: null }, error: null })
    await renderPage(<CalibrationHistoryTab workerId="w1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }))
    await waitFor(() => expect(historyMock).toHaveBeenLastCalledWith('w1', 'c-2'))
    const third = await screen.findByTestId('history-item-h3')
    expect(third).toHaveTextContent('Para: aprendido')
    expect(screen.getByTestId('history-item-h1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
  })

  it('sem mudanças, diz que não há nada', async () => {
    historyMock.mockResolvedValue({ data: { items: [], nextCursor: null }, error: null })
    await renderPage(<CalibrationHistoryTab workerId="w1" />)
    expect(await screen.findByText('Nenhuma mudança registrada.')).toBeInTheDocument()
  })

  it('falha mostra a frase e tenta de novo', async () => {
    historyMock
      .mockResolvedValueOnce({ data: null, error: { message: 'Falha ao carregar o histórico' } })
      .mockResolvedValueOnce({ data: { items: [item({})], nextCursor: null }, error: null })
    await renderPage(<CalibrationHistoryTab workerId="w1" />)

    expect(await screen.findByText('Falha ao carregar o histórico')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByTestId('history-item-h1')).toBeInTheDocument()
  })
})
