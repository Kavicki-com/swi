// A barra de "Tempo até atingir fadiga total" enche até o horizonte da fórmula
// do backend (480 min, um turno): acima dele a estimativa nem existe.
// vitest globals (describe/it/expect) via globals: true.
import { screen } from '@testing-library/react'
import { renderPage } from '@/test-utils/renderPage'
import { FATIGUE_BAR_HORIZON_MIN, WorkerFatigueBar } from './WorkerFatigueBar'

const widthFor = async (minutes: number | null) => {
  const { unmount } = await renderPage(<WorkerFatigueBar fatigueEta={{ minutes, label: 'x' }} />)
  const width = screen.getByTestId('fatigue-bar-fill').style.width
  unmount()
  return width
}

describe('WorkerFatigueBar', () => {
  it('o horizonte é o mesmo da fórmula do backend', () => {
    expect(FATIGUE_BAR_HORIZON_MIN).toBe(480)
  })

  it('a barra enche proporcional ao horizonte e para no cheio', async () => {
    expect(await widthFor(240)).toBe('50%')
    expect(await widthFor(480)).toBe('100%')
    expect(await widthFor(600)).toBe('100%')
    expect(await widthFor(null)).toBe('0%')
  })
})
