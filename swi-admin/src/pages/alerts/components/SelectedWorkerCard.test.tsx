// Cartão do pino em /alerts: fica inteiro dentro do mapa nos dois eixos, com
// o X de fechar (que sai da caixa) também à vista.
import { act, render, screen } from '@testing-library/react'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import type { DashboardMapMarker } from '@/services/dashboard'
import { SelectedWorkerCard } from './SelectedWorkerCard'

const MARKER: DashboardMapMarker = {
  id: 'w1',
  name: 'Ana Souza',
  lat: -23.5,
  lng: -46.6,
  status: 'good',
  avatarUri: '',
}

const renderCard = (position: { left: number; top: number }) =>
  render(
    <SwiThemeProvider>
      <SelectedWorkerCard
        marker={MARKER}
        entry={undefined}
        position={position}
        mapSize={{ width: 1200, height: 600 }}
        onClose={vi.fn()}
        onCreateRescue={vi.fn()}
      />
    </SwiThemeProvider>,
  )

// O jsdom não mede nada: o onLayout do react-native-web fica pendurado no nó
// e é chamado aqui com a medida que o navegador daria. `__reactLayoutHandler`
// é detalhe interno do react-native-web 0.19 (useElementLayout): ao atualizar
// a versão, é lá que se confere se o nome mudou.
const layout = (el: HTMLElement, width: number, height: number) =>
  act(() => {
    const node = el as unknown as { __reactLayoutHandler: (e: unknown) => void }
    node.__reactLayoutHandler({ nativeEvent: { layout: { x: 0, y: 0, width, height } } })
  })

describe('SelectedWorkerCard, posição', () => {
  it('com espaço, nasce ao lado do pino e acima dele, sem transform', async () => {
    renderCard({ left: 100, top: 300 })
    const card = screen.getByTestId('alerts-selected-worker')
    // Sem medida, o cartão espera invisível em vez de piscar fora do mapa.
    expect(card.style.opacity).toBe('0')
    await layout(card, 602, 200)
    expect(card.style.opacity).toBe('1')
    expect(card.style.left).toBe('108px')
    expect(card.style.top).toBe('180px')
    expect(card.style.transform).toBe('')
  })

  it('pino perto do topo e da borda direita, o cartão e o X ficam dentro do mapa', async () => {
    renderCard({ left: 1100, top: 40 })
    const card = screen.getByTestId('alerts-selected-worker')
    await layout(card, 602, 200)
    // O X sai 10 px acima e 10 px à direita da caixa do cartão.
    expect(card.style.left).toBe('588px')
    expect(card.style.top).toBe('10px')
  })
})
