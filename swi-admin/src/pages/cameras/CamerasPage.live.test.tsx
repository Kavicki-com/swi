// Aba "Ao vivo" da tela /cameras: quem está transmitindo e o vídeo do
// funcionário escolhido. O estado da aba (socket, lista, conexão) tem teste
// próprio em hooks/useLiveRoom.test.ts; aqui ele é um dublê e interessa a tela.
import { vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import type { LiveBroadcast } from '@/services/api/live'
import type { LiveViewState } from '@/services/live/liveViewer'
import type { LiveRoom } from './hooks/useLiveRoom'
import { seedSession, settled } from '@/test-utils/renderPage'
import { CamerasPage } from './CamerasPage'

const cameras = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/services/api/cameras', () => ({ camerasApi: cameras }))
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => null }))

const room = vi.hoisted(() => {
  const state = { current: null as unknown as LiveRoom }
  return { state, hook: vi.fn((_id: string | null) => state.current) }
})
vi.mock('./hooks/useLiveRoom', () => ({ useLiveRoom: room.hook }))

const ana: LiveBroadcast = {
  workerId: 'w1',
  name: 'Ana Campo',
  startedAt: '2026-10-05T14:32:00.000Z',
}
const bruno: LiveBroadcast = {
  workerId: 'w2',
  name: 'Bruno Lima',
  startedAt: '2026-10-05T14:40:00.000Z',
}
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

const setRoom = (over: Partial<LiveRoom> = {}, view: Partial<LiveViewState> = {}) => {
  room.state.current = {
    broadcasts: [ana, bruno],
    loading: false,
    error: false,
    retryList: vi.fn(),
    retryWatch: vi.fn(),
    view: { status: 'idle', workerId: null, stream: null, ...view },
    ...over,
  }
  return room.state.current
}

function Where() {
  const location = useLocation()
  return <div data-testid="where">{location.search}</div>
}

const tree = (route: string) => (
  <SwiThemeProvider>
    <AuthProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route
            path="/cameras"
            element={
              <>
                <CamerasPage />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  </SwiThemeProvider>
)

async function renderAt(route: string) {
  seedSession()
  return settled(render(tree(route)))
}

const where = () => screen.getByTestId('where').textContent
const lastAsked = () => room.hook.mock.calls.at(-1)?.[0]

beforeEach(() => {
  cameras.list.mockReset().mockResolvedValue([])
  room.hook.mockClear()
  setRoom()
})

describe('CamerasPage: aba Ao vivo', () => {
  it('a aba "Ao vivo" troca a tela e some com o cadastro de câmera', async () => {
    await renderAt('/cameras')
    expect(screen.getByRole('button', { name: 'Nova câmera' })).toBeTruthy()
    expect(room.hook).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Ao vivo'))
    expect(where()).toBe('?aba=ao-vivo')
    expect(screen.queryByRole('button', { name: 'Nova câmera' })).toBeNull()
    expect(screen.queryByTestId('cameras-search')).toBeNull()
    expect(screen.getByText('Ana Campo')).toBeTruthy()

    fireEvent.click(screen.getByText('Câmeras fixas'))
    expect(where()).toBe('')
  })

  it('lista quem está transmitindo com a hora em que ligou', async () => {
    await renderAt('/cameras?aba=ao-vivo')
    expect(screen.getByText('Ana Campo')).toBeTruthy()
    expect(screen.getByText(`Ao vivo desde ${hhmm(ana.startedAt)}`)).toBeTruthy()
    expect(screen.getByText(`Ao vivo desde ${hhmm(bruno.startedAt)}`)).toBeTruthy()
    expect(screen.getByText('Selecione um funcionário da lista para assistir.')).toBeTruthy()
  })

  it('carregando, lista vazia e falha têm cada um o seu texto', async () => {
    setRoom({ loading: true, broadcasts: [] })
    const { unmount } = await renderAt('/cameras?aba=ao-vivo')
    expect(screen.getByText('Carregando transmissões…')).toBeTruthy()
    unmount()

    setRoom({ broadcasts: [] })
    const second = await renderAt('/cameras?aba=ao-vivo')
    expect(
      screen.getByText(
        'Nenhum funcionário transmitindo agora. A transmissão começa quando o funcionário liga a câmera no app.',
      ),
    ).toBeTruthy()
    second.unmount()

    const current = setRoom({ error: true, broadcasts: [] })
    await renderAt('/cameras?aba=ao-vivo')
    expect(screen.getByText('Não foi possível carregar as transmissões.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(current.retryList).toHaveBeenCalled()
  })

  it('escolher alguém da lista pede o vídeo dele', async () => {
    await renderAt('/cameras?aba=ao-vivo')
    expect(lastAsked()).toBeNull()
    fireEvent.click(screen.getByText('Ana Campo'))
    expect(where()).toBe('?aba=ao-vivo&funcionario=w1')
    expect(lastAsked()).toBe('w1')
  })

  it('o endereço com o funcionário abre direto no vídeo dele', async () => {
    setRoom({}, { status: 'connecting', workerId: 'w1' })
    await renderAt('/cameras?aba=ao-vivo&funcionario=w1')
    expect(lastAsked()).toBe('w1')
    expect(screen.getByText('Conectando à câmera de Ana Campo…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Parar de assistir' }))
    expect(where()).toBe('?aba=ao-vivo')
    expect(lastAsked()).toBeNull()
  })

  it('com o vídeo chegando, mostra o elemento de vídeo com a imagem do celular', async () => {
    const stream = { id: 'video' } as unknown as MediaStream
    setRoom({}, { status: 'playing', workerId: 'w1', stream })
    await renderAt('/cameras?aba=ao-vivo&funcionario=w1')
    const video = screen.getByLabelText('Câmera ao vivo de Ana Campo') as HTMLVideoElement
    expect(video.tagName).toBe('VIDEO')
    expect(video.srcObject).toBe(stream)
    expect(video.muted).toBe(true)
    expect(screen.getByRole('button', { name: 'Parar de assistir' })).toBeTruthy()
  })

  it('o funcionário desligou: o nome continua, mesmo já fora da lista', async () => {
    const route = '/cameras?aba=ao-vivo&funcionario=w1'
    setRoom({}, { status: 'playing', workerId: 'w1', stream: {} as MediaStream })
    const view = await renderAt(route)
    // Parar tira Ana da lista e encerra o vídeo no mesmo instante.
    setRoom({ broadcasts: [bruno] }, { status: 'ended', workerId: 'w1' })
    view.rerender(tree(route))
    expect(screen.getByText('Ana Campo desligou a câmera.')).toBeTruthy()
    expect(screen.queryByLabelText('Câmera ao vivo de Ana Campo')).toBeNull()
  })

  it('funcionário que não está na lista lida desfaz a escolha, sem sessão escondida', async () => {
    setRoom({ broadcasts: [bruno] }, { status: 'ended', workerId: 'w1' })
    await renderAt('/cameras?aba=ao-vivo&funcionario=w1')
    expect(where()).toBe('?aba=ao-vivo')
    expect(lastAsked()).toBeNull()
    expect(screen.getByText('Selecione um funcionário da lista para assistir.')).toBeTruthy()
  })

  it('enquanto a lista carrega, a escolha espera sem mostrar vídeo nem aviso', async () => {
    setRoom({ loading: true, broadcasts: [] }, { status: 'connecting', workerId: 'w1' })
    await renderAt('/cameras?aba=ao-vivo&funcionario=w1')
    expect(where()).toBe('?aba=ao-vivo&funcionario=w1')
    expect(screen.queryByTestId('live-viewer')).toBeNull()
    expect(screen.getAllByText('Carregando transmissões…')).toHaveLength(1)
  })

  it('o aviso do vídeo é anunciado para leitor de tela', async () => {
    setRoom({}, { status: 'connecting', workerId: 'w1' })
    await renderAt('/cameras?aba=ao-vivo&funcionario=w1')
    expect(screen.getByText('Conectando à câmera de Ana Campo…').getAttribute('aria-live')).toBe(
      'polite',
    )
  })

  it.each([
    ['full', 'Esta transmissão já tem 3 administradores assistindo. Tente de novo mais tarde.'],
    [
      'failed',
      'Não foi possível receber a imagem. A rede do celular ou do painel pode estar bloqueando a conexão direta.',
    ],
  ] as const)('estado %s mostra o aviso e deixa tentar de novo', async (status, text) => {
    const current = setRoom({}, { status, workerId: 'w1' })
    await renderAt('/cameras?aba=ao-vivo&funcionario=w1')
    const viewer = screen.getByTestId('live-viewer')
    expect(within(viewer).getByText(text)).toBeTruthy()
    fireEvent.click(within(viewer).getByRole('button', { name: 'Tentar novamente' }))
    expect(current.retryWatch).toHaveBeenCalled()
  })

  it('transmissão encerrada mostra que o funcionário desligou', async () => {
    setRoom({}, { status: 'ended', workerId: 'w1' })
    await renderAt('/cameras?aba=ao-vivo&funcionario=w1')
    expect(screen.getByText('Ana Campo desligou a câmera.')).toBeTruthy()
  })
})
