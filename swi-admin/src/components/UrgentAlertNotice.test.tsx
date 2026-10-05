import { vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { alertItem } from '@/test-utils/telemetryFixtures'
import { whenLabel } from '@/lib/whenLabel'

const h = vi.hoisted(() => ({ view: null as unknown, navigate: vi.fn() }))
vi.mock('@/services/alerts/UrgentAlertsProvider', () => ({
  URGENT_ALERTS_PATH: '/monitoring/alerts',
  useUrgentAlerts: () => h.view,
}))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}))

import { act } from '@testing-library/react'
import { setBellOpen } from '@/services/notifications/bellPanel'
import { UrgentAlertNotice } from './UrgentAlertNotice'

const at = '2026-10-05T12:00:00.000Z'
const joao = alertItem('a', {
  worker: { id: 'w', name: 'João Silva', sector: null },
  condition: { ...alertItem('a').condition, openedAt: at },
})

const withAlerts = (visible: unknown[]) => {
  const dismiss = vi.fn()
  h.view = { visible, dismiss }
  return dismiss
}

beforeEach(() => {
  h.navigate.mockReset()
})

afterEach(() => clearSession())

describe('UrgentAlertNotice', () => {
  it('sem provider ou sem alerta, não mostra nada', async () => {
    h.view = null
    const { unmount } = await renderPage(<UrgentAlertNotice />)
    expect(screen.queryByTestId('urgent-alert-notice')).toBeNull()
    unmount()
    withAlerts([])
    await renderPage(<UrgentAlertNotice />)
    expect(screen.queryByTestId('urgent-alert-notice')).toBeNull()
  })

  it('um alerta: nome, condição e hora', async () => {
    withAlerts([joao])
    await renderPage(<UrgentAlertNotice />)
    expect(screen.getByText('Alerta urgente: João Silva')).toBeTruthy()
    expect(
      screen.getByText(`Frequência cardíaca alta, aberto ${whenLabel(at, Date.now())}.`),
    ).toBeTruthy()
  })

  it('vários: quantos e o mais recente', async () => {
    withAlerts([joao, alertItem('b'), alertItem('c')])
    await renderPage(<UrgentAlertNotice />)
    expect(screen.getByText('3 alertas urgentes')).toBeTruthy()
    expect(screen.getByText(/^Mais recente: João Silva, frequência cardíaca alta/)).toBeTruthy()
  })

  it('o leitor de tela ouve título e mensagem', async () => {
    withAlerts([joao])
    await renderPage(<UrgentAlertNotice />)
    expect(screen.getByTestId('urgent-alert-notice').getAttribute('aria-label')).toBe(
      `Alerta urgente: João Silva. Frequência cardíaca alta, aberto ${whenLabel(at, Date.now())}.`,
    )
  })

  it('Ver no monitoramento leva à fila de alertas e esconde o aviso', async () => {
    const dismiss = withAlerts([joao])
    await renderPage(<UrgentAlertNotice />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver no monitoramento' }))
    expect(h.navigate).toHaveBeenCalledWith('/monitoring/alerts')
    expect(dismiss).toHaveBeenCalled()
  })

  // A lista do sino e o aviso ocupam o alto da tela: com a lista aberta, o
  // aviso sai da frente e volta quando ela fecha.
  it('com a lista do sino aberta, o aviso some e volta quando ela fecha', async () => {
    withAlerts([joao])
    await renderPage(<UrgentAlertNotice />)
    act(() => setBellOpen(true))
    expect(screen.queryByTestId('urgent-alert-notice')).toBeNull()
    act(() => setBellOpen(false))
    expect(screen.getByTestId('urgent-alert-notice')).toBeTruthy()
  })

  it('Fechar esconde o aviso', async () => {
    const dismiss = withAlerts([joao])
    await renderPage(<UrgentAlertNotice />)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(dismiss).toHaveBeenCalled()
    expect(h.navigate).not.toHaveBeenCalled()
  })
})
