import { createPinElement } from './pinFactory'

describe('createPinElement', () => {
  it('returns a clickable div with cursor pointer', () => {
    const onClick = vi.fn()
    const { el, root } = createPinElement({
      onClick,
      content: <span data-testid="pin">pin</span>,
    })
    expect(el.tagName).toBe('DIV')
    expect(el.style.cursor).toBe('pointer')
    el.click()
    expect(onClick).toHaveBeenCalledOnce()
    root.unmount()
  })

  it('leva o texto de passar o mouse quando recebe um', () => {
    const { el, root } = createPinElement({
      onClick: vi.fn(),
      content: <span />,
      title: 'Ana Souza, última posição às 14:32',
    })
    expect(el.title).toBe('Ana Souza, última posição às 14:32')
    root.unmount()
  })

  it('com ação, o clique fica no pino e não chega ao mapa', () => {
    const onClick = vi.fn()
    const onMapClick = vi.fn()
    const map = document.createElement('div')
    map.addEventListener('click', onMapClick)
    const { el, root } = createPinElement({ onClick, content: <span /> })
    map.appendChild(el)
    el.click()
    expect(onClick).toHaveBeenCalledOnce()
    expect(onMapClick).not.toHaveBeenCalled()
    root.unmount()
  })

  it('sem ação, o clique atravessa para o mapa e o pino não tem cursor de clique', () => {
    const onMapClick = vi.fn()
    const map = document.createElement('div')
    map.addEventListener('click', onMapClick)
    const { el, root } = createPinElement({ content: <span /> })
    map.appendChild(el)
    el.click()
    expect(onMapClick).toHaveBeenCalledOnce()
    expect(el.style.cursor).toBe('')
    root.unmount()
  })

  it('sem texto, o pino não ganha atributo de título', () => {
    const { el, root } = createPinElement({ onClick: vi.fn(), content: <span /> })
    expect(el.hasAttribute('title')).toBe(false)
    root.unmount()
  })
})
