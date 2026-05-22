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
})
