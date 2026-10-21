// describe/it/expect vêm dos globals do Vitest.
import { screen } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import type { CalibrationLine } from '@/services/vitals/calibrationView'
import { WorkerCalibrationLine } from './WorkerCalibrationLine'

const LINE: CalibrationLine = {
  zone: { label: 'Normal', status: 'info' },
  limits: 'excelência até 118, fadiga a partir de 146',
}

// O StatusTag do DS se prende à esquerda (alignSelf próprio), então quem
// centra o selo é o invólucro dele, seguindo o `align` da linha.
const wrapAlign = () =>
  window.getComputedStyle(screen.getByTestId('hr-zone-wrap')).getPropertyValue('align-self')

afterEach(() => clearSession())

describe('WorkerCalibrationLine', () => {
  it('sob as roscas, o selo fica centrado como a frase', async () => {
    await renderPage(<WorkerCalibrationLine line={LINE} testIDPrefix="hr" />)
    expect(wrapAlign()).toBe('center')
    expect(screen.getByTestId('hr-zone')).toHaveTextContent('Normal')
  })

  it('no card de vitais, o selo segue à esquerda', async () => {
    await renderPage(<WorkerCalibrationLine line={LINE} testIDPrefix="hr" align="flex-start" />)
    expect(wrapAlign()).toBe('flex-start')
  })

  it('sem zona não desenha o invólucro', async () => {
    await renderPage(
      <WorkerCalibrationLine line={{ zone: null, limits: LINE.limits }} testIDPrefix="hr" />,
    )
    expect(screen.queryByTestId('hr-zone-wrap')).not.toBeInTheDocument()
    expect(screen.getByTestId('hr-limits')).toBeInTheDocument()
  })
})
