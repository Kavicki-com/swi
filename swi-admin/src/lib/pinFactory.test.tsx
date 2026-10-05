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

  it('sem texto, o pino não ganha atributo de título', () => {
    const { el, root } = createPinElement({ onClick: vi.fn(), content: <span /> })
    expect(el.hasAttribute('title')).toBe(false)
    root.unmount()
  })
})
