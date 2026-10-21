// O card de vitais só desenha o que o vitalsView decidiu: com calibração, a
// zona de agora (selo do DS) e a faixa da pessoa abaixo do card, para o
// batimento e para a pressão; sem calibração, nada além do que já havia.
// vitest globals (describe/it/expect) via globals: true.
import { screen } from '@testing-library/react'
import { renderPage } from '@/test-utils/renderPage'
import {
  NO_VITALS_CALIBRATION,
  vitalsViewFrom,
  type WorkerVitalsView,
} from '@/services/vitals/vitalsView'
import { WorkerVitalsCard } from './WorkerVitalsCard'

const BASE: WorkerVitalsView = { ...vitalsViewFrom(null), heartRate: '112', pressure: '128/82' }

const CALIBRATED: WorkerVitalsView = {
  ...BASE,
  calibration: {
    ...NO_VITALS_CALIBRATION,
    heartRate: {
      zone: { label: 'Normal', status: 'info' },
      limits: 'excelência até 68, fadiga a partir de 128',
    },
    pressure: {
      zone: { label: 'Fadiga', status: 'canceled' },
      limits: 'fadiga a partir de 135/88',
    },
  },
}

describe('WorkerVitalsCard', () => {
  it('com calibração mostra a zona e a faixa do batimento e da pressão', async () => {
    await renderPage(<WorkerVitalsCard vitals={CALIBRATED} />)
    expect(screen.getByTestId('heartRate-zone')).toHaveTextContent('Normal')
    expect(screen.getByTestId('heartRate-limits')).toHaveTextContent(
      'excelência até 68, fadiga a partir de 128',
    )
    expect(screen.getByTestId('pressure-zone')).toHaveTextContent('Fadiga')
    expect(screen.getByTestId('pressure-limits')).toHaveTextContent('fadiga a partir de 135/88')
  })

  it('faixa sem zona mostra só a faixa', async () => {
    await renderPage(
      <WorkerVitalsCard
        vitals={{
          ...CALIBRATED,
          calibration: {
            ...CALIBRATED.calibration,
            heartRate: { zone: null, limits: 'fadiga a partir de 128' },
          },
        }}
      />,
    )
    expect(screen.queryByTestId('heartRate-zone')).not.toBeInTheDocument()
    expect(screen.getByTestId('heartRate-limits')).toHaveTextContent('fadiga a partir de 128')
  })

  it('sem calibração não desenha zona nem faixa', async () => {
    await renderPage(<WorkerVitalsCard vitals={BASE} />)
    expect(screen.queryByTestId(/-(zone|limits)$/)).not.toBeInTheDocument()
  })
})
