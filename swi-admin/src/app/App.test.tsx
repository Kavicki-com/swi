import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { seedSession, settleAuth } from '@/test-utils/renderPage'

// Dublê marcável: o componente real só injeta CSS, que não deixa rastro
// observável no jsdom (ver o teste do autofill abaixo).
vi.mock('./GlobalStyles', () => ({
  GlobalStyles: () => <div data-testid="global-styles" />,
}))

// Dublês para montar a área logada sem rede: o aviso de conexão vira um
// marcador, o chat só repassa os filhos e o mapa geral é uma tela vazia.
vi.mock('@/components/ConnectionNotice', () => ({
  ConnectionNotice: () => <div data-testid="connection-notice-mount" />,
}))
vi.mock('@/services/chat/ChatProvider', () => ({
  ChatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/services/notifications/NotificationsProvider', () => ({
  NotificationsProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="notifications-provider">{children}</div>
  ),
  useNotifications: () => null,
}))
vi.mock('@/services/alerts/UrgentAlertsProvider', () => ({
  URGENT_ALERTS_PATH: '/monitoring/alerts',
  UrgentAlertsProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="urgent-alerts-provider">{children}</div>
  ),
  useUrgentAlerts: () => null,
}))
vi.mock('@/pages/maps/MapsGeneral', () => ({
  MapsGeneral: () => <div data-testid="maps-general-stub" />,
}))

afterEach(() => {
  window.localStorage.clear()
})

describe('App', () => {
  it('renders inside SwiThemeProvider without crashing', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    await settleAuth()
    expect(screen.getByTestId('app-root')).toBeInTheDocument()
  })

  // Sem o GlobalStyles o Chrome pinta de amarelo todo campo que ele
  // autopreenche, furando o tema escuro.
  //
  // O teste guarda a MONTAGEM, não o CSS. Verificar o CSS aqui é impossível: o
  // jsdom lê as regras do styled-components (13 KB delas), mas DESCARTA esta,
  // porque não reconhece o pseudo-seletor `:-webkit-autofill`. A regra em si
  // foi conferida no navegador, com as cores do tema resolvidas.
  //
  // O que este teste pega é o modo silencioso de perder a correção: alguém tira
  // <GlobalStyles /> do App e nada mais quebra.
  it('monta o GlobalStyles, que neutraliza o autofill do Chrome', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    await settleAuth()
    expect(screen.getByTestId('global-styles')).toBeInTheDocument()
  })

  // O aviso de sem conexão mora no ChatShell, que envolve também as telas de
  // tela cheia (Mapas e Chat), fora do AppLayout.
  it('monta o aviso de sem conexão na área logada, inclusive no mapa geral', async () => {
    seedSession()
    render(
      <MemoryRouter initialEntries={['/maps/general']}>
        <App />
      </MemoryRouter>,
    )
    await settleAuth()
    expect(await screen.findByTestId('maps-general-stub')).toBeInTheDocument()
    expect(screen.getByTestId('connection-notice-mount')).toBeInTheDocument()
  })

  // O sino e o aviso de alerta urgente valem em toda a área logada, inclusive
  // nas telas de tela cheia.
  it('monta as notificações e o aviso de alerta urgente na área logada', async () => {
    seedSession()
    render(
      <MemoryRouter initialEntries={['/maps/general']}>
        <App />
      </MemoryRouter>,
    )
    await settleAuth()
    expect(await screen.findByTestId('maps-general-stub')).toBeInTheDocument()
    expect(screen.getByTestId('notifications-provider')).toBeInTheDocument()
    expect(screen.getByTestId('urgent-alerts-provider')).toBeInTheDocument()
  })

  it('fora da área logada não há aviso de conexão', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )
    await settleAuth()
    expect(screen.queryByTestId('connection-notice-mount')).toBeNull()
  })
})
