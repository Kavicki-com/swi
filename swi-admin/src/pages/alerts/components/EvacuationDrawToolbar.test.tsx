// Barra do desenho da evacuação: o passo do ponto de encontro só abre com a
// área fechada.
import { fireEvent, render, screen } from '@testing-library/react'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { EvacuationDrawToolbar } from './EvacuationDrawToolbar'

const handlers = () => ({
  onUndo: vi.fn(),
  onCancel: vi.fn(),
  onNext: vi.fn(),
  onBack: vi.fn(),
  onConfirm: vi.fn(),
})

const renderArea = (vertexCount: number, closed: boolean, h = handlers()) => {
  render(
    <SwiThemeProvider>
      <EvacuationDrawToolbar
        step="area"
        vertexCount={vertexCount}
        closed={closed}
        hasMuster={false}
        {...h}
      />
    </SwiThemeProvider>,
  )
  return h
}

describe('EvacuationDrawToolbar: passo da área', () => {
  it('aberto com menos de três pontos, pede mais pontos e não avança', () => {
    const h = renderArea(2, false)
    expect(screen.getByText('Toque no mapa para marcar a área (2 pontos)')).toBeTruthy()
    fireEvent.click(screen.getByText('Próximo: ponto de encontro'))
    expect(h.onNext).not.toHaveBeenCalled()
  })

  it('aberto com três pontos, ensina a fechar e ainda não avança', () => {
    const h = renderArea(3, false)
    expect(screen.getByText('Toque no primeiro ponto para fechar a área (3 pontos)')).toBeTruthy()
    fireEvent.click(screen.getByText('Próximo: ponto de encontro'))
    expect(h.onNext).not.toHaveBeenCalled()
  })

  it('fechado, diz que a área fechou e avança', () => {
    const h = renderArea(3, true)
    expect(screen.getByText('Área fechada, 3 pontos')).toBeTruthy()
    fireEvent.click(screen.getByText('Próximo: ponto de encontro'))
    expect(h.onNext).toHaveBeenCalledTimes(1)
  })

  it('fechado, desfazer continua disponível para reabrir', () => {
    const h = renderArea(3, true)
    fireEvent.click(screen.getByText('Desfazer'))
    expect(h.onUndo).toHaveBeenCalledTimes(1)
  })
})
