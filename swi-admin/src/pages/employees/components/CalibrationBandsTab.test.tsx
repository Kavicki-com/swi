// describe/it/expect/vi vêm dos globals do Vitest.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { heartRateBand, temperatureBand } from '@/test-utils/calibrationFixtures'
import { CalibrationBandsTab } from './CalibrationBandsTab'

const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => toast }))

const input = (id: string) => screen.getByTestId(id) as HTMLInputElement
const type = (id: string, value: string) => fireEvent.change(input(id), { target: { value } })

afterEach(() => {
  clearSession()
  toast.show.mockReset()
})

describe('CalibrationBandsTab', () => {
  it('mostra dias válidos, aprendido e em vigor, com os cortes nos campos', async () => {
    await renderPage(
      <CalibrationBandsTab
        metrics={[heartRateBand(), temperatureBand()]}
        onSave={vi.fn()}
        onRevert={vi.fn()}
      />,
    )
    const row = screen.getByTestId('band-row-HEART_RATE')
    expect(row).toHaveTextContent('Batimento cardíaco')
    expect(row).toHaveTextContent('12 dias válidos')
    expect(row).toHaveTextContent('Aprendido: excelência até 118, fadiga a partir de 146')
    expect(row).toHaveTextContent('Em vigor: excelência até 118, fadiga a partir de 146')
    expect(input('band-HEART_RATE-excellence').value).toBe('118')
    expect(input('band-BODY_TEMPERATURE-p10').value).toBe('35,9')
    // Sem correção não há o que desfazer.
    expect(
      screen.queryByRole('button', { name: 'Voltar ao aprendido: Batimento cardíaco' }),
    ).not.toBeInTheDocument()
  })

  it('os campos ficam afastados da frase "Em vigor"', async () => {
    await renderPage(
      <CalibrationBandsTab metrics={[heartRateBand()]} onSave={vi.fn()} onRevert={vi.fn()} />,
    )
    const marginTop = window
      .getComputedStyle(screen.getByTestId('band-inputs-HEART_RATE'))
      .getPropertyValue('margin-top')
    expect(parseFloat(marginTop)).toBeGreaterThan(0)
  })

  it('salva com vírgula decimal e avisa no toast', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    await renderPage(
      <CalibrationBandsTab metrics={[temperatureBand()]} onSave={onSave} onRevert={vi.fn()} />,
    )
    type('band-BODY_TEMPERATURE-p90', '37,5')
    type('band-BODY_TEMPERATURE-p10', '')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar faixa de Temperatura corporal' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('BODY_TEMPERATURE', {
        p10: null,
        p25: 36.2,
        p75: 36.8,
        p90: 37.5,
      }),
    )
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith('Faixa salva', expect.any(String)))
  })

  it('distância em km no campo, em metros para o servidor', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    const distance = heartRateBand({
      metric: 'DISTANCE',
      start: { below: 4000, above: 8000 },
      learned: { below: 4500, above: 8200 },
      effective: { below: 4500, above: 8200 },
    })
    await renderPage(
      <CalibrationBandsTab metrics={[distance]} onSave={onSave} onRevert={vi.fn()} />,
    )
    expect(input('band-DISTANCE-below').value).toBe('4,5')
    expect(input('band-DISTANCE-above').value).toBe('8,2')
    type('band-DISTANCE-below', '5,2')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar faixa de Distância' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('DISTANCE', { below: 5200, above: 8200 }),
    )
  })

  it('cortes fora de ordem não saem da tela', async () => {
    const onSave = vi.fn()
    await renderPage(
      <CalibrationBandsTab metrics={[heartRateBand()]} onSave={onSave} onRevert={vi.fn()} />,
    )
    type('band-HEART_RATE-excellence', '150')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar faixa de Batimento cardíaco' }))
    expect(
      await screen.findByText('O corte de excelência deve ficar abaixo do de fadiga.'),
    ).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a recusa do servidor aparece no toast e na linha', async () => {
    const onSave = vi.fn().mockResolvedValue('Os cortes não podem ser negativos.')
    await renderPage(
      <CalibrationBandsTab metrics={[heartRateBand()]} onSave={onSave} onRevert={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar faixa de Batimento cardíaco' }))
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith(
        'Não foi possível salvar a faixa',
        'Os cortes não podem ser negativos.',
      ),
    )
    expect(screen.getByTestId('band-error-HEART_RATE')).toHaveTextContent(
      'Os cortes não podem ser negativos.',
    )
  })

  it('com correção, volta ao aprendido depois de confirmar', async () => {
    const onRevert = vi.fn().mockResolvedValue(null)
    const corrected = heartRateBand({
      override: { excellence: 110, fatigue: 140 },
      effective: { excellence: 110, fatigue: 140 },
      source: 'OVERRIDE',
    })
    await renderPage(
      <CalibrationBandsTab metrics={[corrected]} onSave={vi.fn()} onRevert={onRevert} />,
    )
    expect(screen.getByTestId('band-row-HEART_RATE')).toHaveTextContent('Corrigida pelo gestor')
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao aprendido: Batimento cardíaco' }))
    expect(screen.getByText('Voltar ao aprendido?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao aprendido' }))
    await waitFor(() => expect(onRevert).toHaveBeenCalledWith('HEART_RATE'))
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith('Faixa de volta ao aprendido', expect.any(String)),
    )
  })
})
