// O sino fica à esquerda do avatar em todos os cabeçalhos: o do layout com
// menu (desktop e tablet) e os das telas cheias, Mapas e Chat. O sino em si é
// testado em NotificationBell.test; aqui ele é um marcador, e os dublês são o
// mínimo para cada tela montar.
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { clearSession, renderPage, seedSession, settled } from '@/test-utils/renderPage'

vi.mock('@/components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="bell-mark" />,
}))

const bp = vi.hoisted(() => ({ value: 'desktop' as string }))
vi.mock('@/hooks/useBreakpoint', () => ({ useBreakpoint: () => bp.value }))

vi.mock('@/services/api/telemetryDevices', () => ({
  telemetryDevicesApi: {
    stateOf: vi
      .fn()
      .mockResolvedValue({ data: { device: null, pendingEnrollment: null }, error: null }),
  },
}))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: () => () => {},
}))
vi.mock('@/services/chat/ChatProvider', () => ({
  ChatProvider: ({ children }: { children: ReactNode }) => children,
  useChat: () => ({
    myId: 'me',
    loadStatus: 'ready',
    conversations: [],
    messagesByConv: {},
    directory: [],
    load: async () => {},
    openConversation: async () => {},
    closeConversation: () => {},
    send: async () => ({ error: null }),
    editMessage: async () => ({ error: null }),
    deleteMessage: async () => ({ error: null }),
    keyFor: (id: string) => ['me', id].sort().join('#'),
  }),
}))
vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => null }))
vi.mock('@/hooks/useAdminTelemetry', () => ({
  useAdminTelemetry: () => ({
    workers: null,
    summary: null,
    loading: false,
    failed: false,
    refresh: () => {},
  }),
}))
vi.mock('@/services/api/positionHeat', () => ({
  positionHeatApi: { heat: async () => ({ data: null, error: { message: 'sem trilha' } }) },
}))
vi.mock('@/lib/rainViewer', () => ({ getRainViewerLatestRadar: async () => null }))
vi.mock('@/services/api/cameras', () => ({ camerasApi: { list: async () => [] } }))
vi.mock('@/lib/demoToast', () => ({
  useDemoToast: () => ({ show: () => {} }),
  DemoToastProvider: ({ children }: { children: ReactNode }) => children,
}))
const maplibre = vi.hoisted(() => {
  const makeMap = () => ({
    on: (event: string, cb: () => void) => {
      if (event === 'load') cb()
    },
    getLayer: () => undefined,
    getSource: () => undefined,
    addLayer: () => {},
    addSource: () => {},
    removeLayer: () => {},
    removeSource: () => {},
    fitBounds: () => {},
    flyTo: () => {},
    remove: () => {},
  })
  const marker = {
    setLngLat: () => marker,
    addTo: () => marker,
    remove: () => {},
    on: () => marker,
  }
  return {
    lib: {
      Map: vi.fn(() => makeMap()),
      Marker: vi.fn(() => marker),
      LngLatBounds: vi.fn(() => ({ extend: () => {} })),
    },
  }
})
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => maplibre.lib }))

import { AppLayout } from '@/app/AppLayout'
import { MapsGeneral } from '@/pages/maps/MapsGeneral'
import { ChatInbox } from '@/pages/chat/ChatInbox'

afterEach(() => {
  bp.value = 'desktop'
  clearSession()
})

const renderLayout = async () => {
  seedSession()
  return settled(
    render(
      <SwiThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/page']}>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/page" element={<div>página</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </SwiThemeProvider>,
    ),
  )
}

describe('sino nos cabeçalhos', () => {
  it('layout com menu, no desktop', async () => {
    await renderLayout()
    await waitFor(() => expect(screen.getByTestId('app-header')).toBeInTheDocument())
    expect(within(screen.getByTestId('app-header')).getByTestId('bell-mark')).toBeTruthy()
  })

  it('layout com menu, no tablet', async () => {
    bp.value = 'tablet'
    await renderLayout()
    await waitFor(() => expect(screen.getByTestId('app-topbar')).toBeInTheDocument())
    expect(within(screen.getByTestId('app-topbar')).getByTestId('bell-mark')).toBeTruthy()
  })

  it('mapa geral', async () => {
    await renderPage(<MapsGeneral />, { route: '/maps/general' })
    expect(within(screen.getByTestId('maps-header')).getByTestId('bell-mark')).toBeTruthy()
  })

  it('chat', async () => {
    await renderPage(<ChatInbox />, { route: '/chat' })
    expect(within(screen.getByTestId('chat-header')).getByTestId('bell-mark')).toBeTruthy()
  })
})
