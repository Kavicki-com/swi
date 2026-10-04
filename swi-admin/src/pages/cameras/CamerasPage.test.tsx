// Tela /cameras: cadastro dos pontos de câmera e visualização da câmera
// selecionada. describe/it/expect/beforeEach vêm dos globals do Vitest.
//
// O cliente da API é mockado inteiro (o contrato fica em
// services/api/cameras.test.ts); aqui interessa o comportamento da tela.
import { vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { ApiError } from '@/services/api/http'
import type { Camera } from '@/services/api/cameras'
import { seedSession, clearSession, settled } from '@/test-utils/renderPage'
import { CamerasPage } from './CamerasPage'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/services/api/cameras', () => ({ camerasApi: api }))

// Origem da API fixa em https, para o caso do endereço que aponta para o
// próprio SWI: a de desenvolvimento é http e nunca casaria com endereço https.
vi.mock('@/services/api/apiConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api/apiConfig')>()),
  getApiUrl: () => 'https://api.exemplo.com.br',
}))

// Mapa falso: guarda o handler de clique para o teste "clicar" numa posição.
const maplibre = vi.hoisted(() => {
  const clicks: Array<(e: { lngLat: { lng: number; lat: number } }) => void> = []
  const markers: Array<{ lngLats: Array<[number, number]>; removed: boolean }> = []
  const lib = {
    Map: vi.fn(() => ({
      on: (event: string, cb: (e: { lngLat: { lng: number; lat: number } }) => void) => {
        if (event === 'click') clicks.push(cb)
      },
      remove: vi.fn(),
      getCanvas: () => ({ style: {} }),
    })),
    Marker: vi.fn(() => {
      const rec = { lngLats: [] as Array<[number, number]>, removed: false }
      markers.push(rec)
      const marker = {
        setLngLat: (v: [number, number]) => {
          rec.lngLats.push(v)
          return marker
        },
        addTo: () => marker,
        remove: () => {
          rec.removed = true
        },
      }
      return marker
    }),
  }
  const clickAt = (lng: number, lat: number) => clicks.at(-1)?.({ lngLat: { lng, lat } })
  const reset = () => {
    clicks.length = 0
    markers.length = 0
    lib.Map.mockClear()
    lib.Marker.mockClear()
  }
  return { lib, clickAt, markers, reset }
})
vi.mock('@/lib/useMapLibre', () => ({ useMapLibre: () => maplibre.lib }))

const PORTARIA: Camera = {
  id: 'c1',
  name: 'Portaria',
  lat: -3.1,
  lng: -60.02,
  url: 'https://cameras.exemplo.com.br/portaria',
}
const PATIO: Camera = {
  id: 'c2',
  name: 'Pátio',
  lat: -3.2,
  lng: -60.1,
  url: 'http://192.168.0.10/live',
}
const DEPOSITO: Camera = { id: 'c3', name: 'Depósito', lat: -3.3, lng: -60.2, url: null }

async function renderAt(route = '/cameras') {
  seedSession()
  return settled(
    render(
      <SwiThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path="/cameras" element={<CamerasPage />} />
              <Route path="/" element={<div data-testid="dashboard-route" />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </SwiThemeProvider>,
    ),
  )
}

// O pino do formulário monta numa raiz React própria (createPinElement), que
// renderiza depois do clique; o act espera um ciclo para essa montagem acabar.
const clickMapAt = (lng: number, lat: number) =>
  act(async () => {
    maplibre.clickAt(lng, lat)
    await new Promise((r) => setTimeout(r, 0))
  })

const row = (name: string) => screen.getByRole('button', { name: `Ver câmera ${name}` })
const type = (testID: string, value: string) =>
  fireEvent.change(screen.getByTestId(testID), { target: { value } })

beforeEach(() => {
  maplibre.reset()
  api.list.mockReset().mockResolvedValue([PORTARIA, PATIO, DEPOSITO])
  api.create.mockReset()
  api.update.mockReset()
  api.remove.mockReset()
})

afterEach(() => {
  clearSession()
  vi.restoreAllMocks()
})

describe('CamerasPage, lista', () => {
  it('mostra as câmeras cadastradas', async () => {
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    expect(row('Pátio')).toBeInTheDocument()
    expect(row('Depósito')).toBeInTheDocument()
  })

  it('busca filtra pelo nome, sem diferenciar acento nem maiúscula', async () => {
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    type('cameras-search', 'patio')
    expect(screen.queryByRole('button', { name: 'Ver câmera Portaria' })).not.toBeInTheDocument()
    expect(row('Pátio')).toBeInTheDocument()
  })

  it('lista vazia diz que não há câmera cadastrada', async () => {
    api.list.mockResolvedValue([])
    await renderAt()
    await waitFor(() => expect(screen.getByTestId('cameras-empty')).toBeInTheDocument())
  })

  it('falha ao carregar mostra o erro e tenta de novo', async () => {
    api.list.mockRejectedValueOnce(new ApiError('Sem conexão com o servidor', 0))
    await renderAt()
    await waitFor(() =>
      expect(screen.getByTestId('cameras-error')).toHaveTextContent('Sem conexão com o servidor'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
  })

  it('Voltar leva ao dashboard', async () => {
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    await waitFor(() => expect(screen.getByTestId('dashboard-route')).toBeInTheDocument())
  })
})

describe('CamerasPage, visualização', () => {
  it('câmera https abre dentro do painel, isolada, e também em nova aba', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    fireEvent.click(row('Portaria'))

    const frame = screen.getByTitle('Câmera Portaria')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame.getAttribute('src')).toBe(PORTARIA.url)
    // Lista exata: login da câmera (forms) e janelas dela (popups) funcionam,
    // mas nada navega a aba do painel nem escapa do isolamento.
    expect(frame.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-forms allow-popups allow-presentation',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Abrir em nova aba' }))
    expect(open).toHaveBeenCalledWith(PORTARIA.url, '_blank', 'noopener,noreferrer')
  })

  it('câmera http não vira quadro: só nova aba', async () => {
    await renderAt()
    await waitFor(() => expect(row('Pátio')).toBeInTheDocument())
    fireEvent.click(row('Pátio'))
    expect(screen.queryByTitle('Câmera Pátio')).not.toBeInTheDocument()
    expect(screen.getByTestId('camera-viewer')).toHaveTextContent('só abre em nova aba')
    expect(screen.getByTestId('camera-viewer')).toHaveTextContent('http dentro')
    expect(screen.getByRole('button', { name: 'Abrir em nova aba' })).toBeInTheDocument()
  })

  it('endereço do próprio SWI só abre em nova aba, e o aviso não fala de http', async () => {
    api.list.mockResolvedValue([{ ...PORTARIA, url: 'https://api.exemplo.com.br/health' }])
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    fireEvent.click(row('Portaria'))
    expect(screen.queryByTitle('Câmera Portaria')).not.toBeInTheDocument()
    const viewer = screen.getByTestId('camera-viewer')
    expect(viewer).toHaveTextContent('só abre em nova aba')
    expect(viewer).toHaveTextContent('próprio SWI')
    expect(viewer).not.toHaveTextContent('http dentro')
    expect(screen.getByRole('button', { name: 'Abrir em nova aba' })).toBeInTheDocument()
  })

  it('câmera sem endereço diz que falta o endereço', async () => {
    await renderAt()
    await waitFor(() => expect(row('Depósito')).toBeInTheDocument())
    fireEvent.click(row('Depósito'))
    expect(screen.getByTestId('camera-viewer')).toHaveTextContent('Sem endereço cadastrado')
    expect(screen.queryByRole('button', { name: 'Abrir em nova aba' })).not.toBeInTheDocument()
  })

  it('?camera= abre direto a câmera pedida (vinda do pino do mapa)', async () => {
    await renderAt('/cameras?camera=c1')
    await waitFor(() => expect(screen.getByTitle('Câmera Portaria')).toBeInTheDocument())
  })
})

describe('CamerasPage, cadastro', () => {
  it('cria com nome, posição clicada no mapa e endereço', async () => {
    const nova: Camera = {
      id: 'c9',
      name: 'Guarita',
      lat: -3.15,
      lng: -60.05,
      url: 'https://cam.exemplo.com.br/g',
    }
    api.create.mockResolvedValue(nova)
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Nova câmera' }))
    type('camera-form-name', '  Guarita  ')
    type('camera-form-url', ' https://cam.exemplo.com.br/g ')
    await clickMapAt(-60.05, -3.15)
    expect(screen.getByTestId('camera-form-position')).toHaveTextContent('-3.15000, -60.05000')

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        name: 'Guarita',
        lat: -3.15,
        lng: -60.05,
        url: 'https://cam.exemplo.com.br/g',
      }),
    )
    await waitFor(() => expect(row('Guarita')).toBeInTheDocument())
  })

  it('não envia sem nome, sem posição ou com endereço que não é http(s)', async () => {
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Nova câmera' }))
    type('camera-form-url', 'javascript:alert(1)')

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    const form = screen.getByTestId('camera-form')
    expect(within(form).getByText('Informe o nome da câmera.')).toBeInTheDocument()
    expect(within(form).getByText('Clique no mapa para marcar a posição.')).toBeInTheDocument()
    expect(
      within(form).getByText('Informe o endereço completo, começando com http:// ou https://'),
    ).toBeInTheDocument()
    expect(api.create).not.toHaveBeenCalled()

    // Só o esquema, sem o resto do endereço, também não passa.
    type('camera-form-url', 'https://')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(
      within(form).getByText('Informe o endereço completo, começando com http:// ou https://'),
    ).toBeInTheDocument()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('endereço vazio vai como null', async () => {
    api.create.mockResolvedValue({ ...DEPOSITO, id: 'c8', name: 'Rampa' })
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Nova câmera' }))
    type('camera-form-name', 'Rampa')
    await clickMapAt(-60.2, -3.3)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({ name: 'Rampa', lat: -3.3, lng: -60.2, url: null }),
    )
  })

  it('nome repetido mostra a mensagem do servidor e mantém o formulário', async () => {
    api.create.mockRejectedValue(new ApiError('Já existe uma câmera com esse nome', 409))
    const view = await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Nova câmera' }))
    type('camera-form-name', 'Portaria')
    await clickMapAt(-60.02, -3.1)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(screen.getByTestId('camera-form-error')).toHaveTextContent(
        'Já existe uma câmera com esse nome',
      ),
    )
    expect(screen.getByTestId('camera-form')).toBeInTheDocument()
    // O formulário segue aberto: a raiz do pino desmonta aqui, dentro do act.
    await act(async () => view.unmount())
  })

  it('cancelar fecha o formulário sem gravar', async () => {
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Nova câmera' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByTestId('camera-form')).not.toBeInTheDocument()
    expect(api.create).not.toHaveBeenCalled()
  })
})

describe('CamerasPage, edição e exclusão', () => {
  it('edita mandando só o que mudou; limpar o endereço manda null', async () => {
    api.update.mockResolvedValue({ ...PORTARIA, name: 'Portaria Norte', url: null })
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Editar Portaria' }))
    expect(screen.getByTestId('camera-form-name')).toHaveValue('Portaria')
    expect(screen.getByTestId('camera-form-position')).toHaveTextContent('-3.10000, -60.02000')
    type('camera-form-name', 'Portaria Norte')
    type('camera-form-url', '')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith('c1', { name: 'Portaria Norte', url: null }),
    )
    await waitFor(() => expect(row('Portaria Norte')).toBeInTheDocument())
  })

  it('mover o ponto manda a posição nova', async () => {
    api.update.mockResolvedValue({ ...PORTARIA, lat: -3.12, lng: -60.03 })
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Editar Portaria' }))
    await clickMapAt(-60.03, -3.12)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('c1', { lat: -3.12, lng: -60.03 }))
  })

  it('exclui depois de confirmar', async () => {
    api.remove.mockResolvedValue(null)
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Excluir Portaria' }))
    expect(screen.getByText('Excluir câmera?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('c1'))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Ver câmera Portaria' })).not.toBeInTheDocument(),
    )
  })

  it('falha ao excluir mantém a câmera na lista e avisa', async () => {
    api.remove.mockRejectedValue(new ApiError('Câmera não encontrada', 404))
    await renderAt()
    await waitFor(() => expect(row('Portaria')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Portaria' }))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    await waitFor(() =>
      expect(screen.getByTestId('cameras-action-error')).toHaveTextContent('Câmera não encontrada'),
    )
    expect(row('Portaria')).toBeInTheDocument()

    // O aviso não fica preso na tela: some na ação seguinte.
    fireEvent.click(row('Pátio'))
    expect(screen.queryByTestId('cameras-action-error')).not.toBeInTheDocument()
  })
})
