// O gasto calórico ganha a faixa habitual da calibração individual abaixo do
// título, sem zona: o total do dia ainda corre.
// vitest globals (describe/it/expect) via globals: true.
import { screen } from '@testing-library/react'
import { renderPage } from '@/test-utils/renderPage'
import { WorkerCaloriesSection } from './WorkerCaloriesSection'

const renderSection = (usualRange: string | null) =>
  renderPage(
    <WorkerCaloriesSection
      points={[]}
      period="today"
      onPeriodChange={() => {}}
      emptyMessage="Sem medição no período"
      usualRange={usualRange}
    />,
  )

describe('WorkerCaloriesSection', () => {
  it('com calibração mostra a faixa habitual e nenhuma zona', async () => {
    await renderSection('habitual: 350 a 520 kcal')
    expect(screen.getByTestId('activeEnergy-limits')).toHaveTextContent('habitual: 350 a 520 kcal')
    expect(screen.queryByTestId('activeEnergy-zone')).not.toBeInTheDocument()
  })

  it('sem calibração não desenha a faixa', async () => {
    await renderSection(null)
    expect(screen.queryByTestId('activeEnergy-limits')).not.toBeInTheDocument()
    expect(screen.getByTestId('calories-empty')).toHaveTextContent('Sem medição no período')
  })
})
