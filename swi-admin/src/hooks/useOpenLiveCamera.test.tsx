// Botão "Ver câmera da posição" do detalhe e do chat: abre o vídeo de quem
// está transmitindo ou avisa que a pessoa não está transmitindo.
import { vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { DemoToastProvider } from '@/lib/demoToast'
import { useOpenLiveCamera } from './useOpenLiveCamera'

const api = vi.hoisted(() => ({ list: vi.fn(), iceServers: vi.fn() }))
vi.mock('@/services/api/live', () => ({ liveApi: api }))

function Button({ workerId }: { workerId?: string }) {
  const open = useOpenLiveCamera()
  return (
    <button type="button" onClick={() => void open(workerId, 'Ana Campo')}>
      câmera
    </button>
  )
}

function Where() {
  const location = useLocation()
  return <div data-testid="where">{location.pathname + location.search}</div>
}

async function press(workerId?: string) {
  render(
    <SwiThemeProvider>
      <DemoToastProvider>
        <MemoryRouter initialEntries={['/employees/w1']}>
          <Routes>
            <Route path="*" element={<Button workerId={workerId} />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </DemoToastProvider>
    </SwiThemeProvider>,
  )
  await act(async () => {
    fireEvent.click(screen.getByText('câmera'))
  })
}

const where = () => screen.getByTestId('where').textContent

function GoElsewhere() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/reports')}>
      sair
    </button>
  )
}

beforeEach(() => {
  api.list.mockReset()
})

describe('useOpenLiveCamera', () => {
  it('quem está transmitindo abre direto o vídeo na aba Ao vivo', async () => {
    api.list.mockResolvedValue([
      { workerId: 'w1', name: 'Ana Campo', startedAt: '2026-10-05T14:32:00.000Z' },
    ])
    await press('w1')
    expect(where()).toBe('/cameras?aba=ao-vivo&funcionario=w1')
  })

  it('quem não está transmitindo recebe o aviso e a tela fica onde está', async () => {
    api.list.mockResolvedValue([
      { workerId: 'w2', name: 'Bruno', startedAt: '2026-10-05T14:32:00.000Z' },
    ])
    await press('w1')
    expect(where()).toBe('/employees/w1')
    expect(screen.getByText('Câmera da posição')).toBeTruthy()
    expect(screen.getByText('Ana Campo não está transmitindo a câmera agora.')).toBeTruthy()
  })

  it('sem id (administrador, que não transmite) avisa sem consultar o servidor', async () => {
    await press(undefined)
    expect(api.list).not.toHaveBeenCalled()
    expect(screen.getByText('Ana Campo não está transmitindo a câmera agora.')).toBeTruthy()
  })

  it('quem já saiu da tela quando a resposta chega não é levado para Câmeras', async () => {
    let answer!: (list: unknown[]) => void
    api.list.mockImplementation(() => new Promise((r) => (answer = r)))
    render(
      <SwiThemeProvider>
        <DemoToastProvider>
          <MemoryRouter initialEntries={['/employees/w1']}>
            <Routes>
              <Route path="/employees/:id" element={<Button workerId="w1" />} />
              <Route path="*" element={<div>outra tela</div>} />
            </Routes>
            <Where />
            <GoElsewhere />
          </MemoryRouter>
        </DemoToastProvider>
      </SwiThemeProvider>,
    )
    await act(async () => {
      fireEvent.click(screen.getByText('câmera'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('sair'))
    })
    expect(where()).toBe('/reports')
    await act(async () => {
      answer([{ workerId: 'w1', name: 'Ana Campo', startedAt: '2026-10-05T14:32:00.000Z' }])
    })
    expect(where()).toBe('/reports')
  })

  it('falha na consulta pede para tentar de novo', async () => {
    api.list.mockRejectedValue(new Error('fora'))
    await press('w1')
    expect(where()).toBe('/employees/w1')
    expect(screen.getByText('Não foi possível conferir a transmissão. Tente de novo.')).toBeTruthy()
  })
})
