// Helpers de anexo: nome do arquivo a partir da URL e download de uma URL
// presigned. describe/it/expect vêm dos globals do Vitest.
import { vi } from 'vitest'
import { downloadFile, fileNameFromUrl } from './attachments'

describe('fileNameFromUrl', () => {
  it('tira o último segmento, sem a query', () => {
    expect(fileNameFromUrl('https://cdn/x/reports/exame-1.jpg?sig=abc')).toBe('exame-1.jpg')
  })

  it('decodifica o nome escapado', () => {
    expect(fileNameFromUrl('https://cdn/a/foto%20final.png')).toBe('foto final.png')
  })

  it('sem segmento usável devolve undefined', () => {
    expect(fileNameFromUrl('')).toBeUndefined()
    expect(fileNameFromUrl('https://cdn/')).toBeUndefined()
  })
})

describe('downloadFile', () => {
  // unstubAllGlobals além de restoreAllMocks: os globais trocados por
  // stubGlobal (fetch, URL, open) não voltam com restoreAllMocks, e com o
  // vitest em fork único vazariam pros outros arquivos (ex.: window.open).
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('baixa via blob: busca a URL e dispara uma âncora com o nome', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }))
    const createObjectURL = vi.fn().mockReturnValue('blob:obj')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.fn()
    const anchor = { click, href: '', download: '', rel: '' } as unknown as HTMLAnchorElement
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    await downloadFile('https://cdn/reports/exame.jpg?sig=1', 'exame.jpg')

    expect(fetch).toHaveBeenCalledWith('https://cdn/reports/exame.jpg?sig=1')
    expect(anchor.href).toBe('blob:obj')
    expect(anchor.download).toBe('exame.jpg')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:obj')
  })

  it('se o fetch falha (CORS/rede), abre a URL numa aba nova pra salvar à mão', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('CORS')))
    const open = vi.fn()
    vi.stubGlobal('open', open)

    await downloadFile('https://cdn/reports/exame.jpg?sig=1', 'exame.jpg')

    expect(open).toHaveBeenCalledWith('https://cdn/reports/exame.jpg?sig=1', '_blank', 'noopener')
  })
})
