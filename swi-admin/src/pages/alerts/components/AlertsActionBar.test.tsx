// Barra de ações da tela Alertas: socorro e evacuação em grupos separados.
import type { ComponentProps } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AlertsActionBar } from './AlertsActionBar'

type Props = ComponentProps<typeof AlertsActionBar>

const renderBar = (over: Partial<Props> = {}) => {
  const props: Props = {
    drawToolbar: null,
    evacuation: null,
    workersInArea: null,
    pickingRescue: false,
    onRescuePick: vi.fn(),
    onRescueCancel: vi.fn(),
    onRescues: vi.fn(),
    onStartEvacuation: vi.fn(),
    onEndEvacuation: vi.fn(),
    ...over,
  }
  render(
    <SwiThemeProvider>
      <AlertsActionBar {...props} />
    </SwiThemeProvider>,
  )
  return props
}

describe('AlertsActionBar', () => {
  it('mostra os dois grupos com título', () => {
    renderBar()
    const rescue = within(screen.getByTestId('alerts-rescue-group'))
    expect(rescue.getByText('Socorro')).toBeTruthy()
    expect(rescue.getByText('Rota de socorro')).toBeTruthy()
    expect(rescue.getByText('Resgates')).toBeTruthy()
    const evacuation = within(screen.getByTestId('alerts-evacuation-group'))
    expect(evacuation.getByText('Evacuação')).toBeTruthy()
    expect(evacuation.getByText('Iniciar evacuação')).toBeTruthy()
  })

  it('"Rota de socorro" entra na escolha da pessoa e "Resgates" abre o histórico', () => {
    const p = renderBar()
    fireEvent.click(screen.getByText('Rota de socorro'))
    fireEvent.click(screen.getByText('Resgates'))
    expect(p.onRescuePick).toHaveBeenCalledTimes(1)
    expect(p.onRescues).toHaveBeenCalledTimes(1)
  })

  it('escolhendo a pessoa, o grupo de socorro oferece cancelar', () => {
    const p = renderBar({ pickingRescue: true })
    expect(screen.queryByText('Rota de socorro')).toBeNull()
    fireEvent.click(screen.getByText('Cancelar'))
    expect(p.onRescueCancel).toHaveBeenCalledTimes(1)
  })

  it('durante o desenho, socorro fica desabilitado e a barra de desenho toma o grupo de evacuação', () => {
    const p = renderBar({ drawToolbar: <span>barra de desenho</span> })
    expect(screen.getByText('barra de desenho')).toBeTruthy()
    expect(screen.queryByText('Iniciar evacuação')).toBeNull()
    fireEvent.click(screen.getByText('Rota de socorro'))
    expect(p.onRescuePick).not.toHaveBeenCalled()
  })

  it('sem evacuação ativa, oferece iniciar', () => {
    const p = renderBar()
    fireEvent.click(screen.getByText('Iniciar evacuação'))
    expect(p.onStartEvacuation).toHaveBeenCalledTimes(1)
  })

  it('com evacuação ativa, mostra o progresso, quem está na área, e encerra', () => {
    const p = renderBar({ evacuation: { acked: 1, total: 2 }, workersInArea: 2 })
    expect(screen.getByTestId('evacuation-banner')).toBeTruthy()
    expect(screen.getByText('Evacuação em andamento: 1/2 confirmados')).toBeTruthy()
    expect(screen.getByText('2 dentro da área')).toBeTruthy()
    fireEvent.click(screen.getByText('Encerrar evacuação'))
    expect(p.onEndEvacuation).toHaveBeenCalledTimes(1)
  })

  it('evacuação sem área não mostra a contagem', () => {
    renderBar({ evacuation: { acked: 0, total: 2 }, workersInArea: null })
    expect(screen.queryByTestId('evacuation-in-area')).toBeNull()
  })
})
