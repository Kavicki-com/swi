// describe/it/expect vêm dos globals do Vitest (globals: true no config);
// importar hooks de 'vitest' aqui duplica a instância e quebra o runner.
import type { Camera } from '@/services/api/cameras'
import { changesFrom, extractEmbedUrl } from './CameraForm'

describe('extractEmbedUrl', () => {
  it('extrai o src de um trecho de iframe colado', () => {
    expect(
      extractEmbedUrl('<iframe src="https://player.exemplo.com.br/cam/1" width="640"></iframe>'),
    ).toBe('https://player.exemplo.com.br/cam/1')
  })

  it('aceita aspas simples e atributos antes do src', () => {
    expect(
      extractEmbedUrl(
        "<iframe allowfullscreen src='https://player.exemplo.com.br/cam/2'></iframe>",
      ),
    ).toBe('https://player.exemplo.com.br/cam/2')
  })

  it('uma URL colada direto passa aparada', () => {
    expect(extractEmbedUrl('  https://player.exemplo.com.br/cam/3  ')).toBe(
      'https://player.exemplo.com.br/cam/3',
    )
  })

  it('vazio ou só espaço vira null', () => {
    expect(extractEmbedUrl('')).toBeNull()
    expect(extractEmbedUrl('   ')).toBeNull()
  })

  it('trecho de iframe sem src vira null', () => {
    expect(extractEmbedUrl('<iframe width="640"></iframe>')).toBeNull()
  })
})

describe('changesFrom (player embutido)', () => {
  const base: Camera = {
    id: 'c1',
    name: 'Portaria',
    lat: -3.1,
    lng: -60.02,
    url: null,
    embedUrl: null,
  }
  const input = { name: 'Portaria', lat: -3.1, lng: -60.02, url: null }

  it('inclui embedUrl no patch só quando ele muda', () => {
    expect(changesFrom(base, { ...input, embedUrl: 'https://player.exemplo.com.br/x' })).toEqual({
      embedUrl: 'https://player.exemplo.com.br/x',
    })
  })

  it('apagar o player manda embedUrl null', () => {
    expect(
      changesFrom(
        { ...base, embedUrl: 'https://player.exemplo.com.br/x' },
        { ...input, embedUrl: null },
      ),
    ).toEqual({ embedUrl: null })
  })

  it('player igual não entra no patch', () => {
    expect(changesFrom(base, { ...input, embedUrl: null })).toEqual({})
    expect(
      changesFrom(
        { ...base, embedUrl: 'https://player.exemplo.com.br/x' },
        { ...input, embedUrl: 'https://player.exemplo.com.br/x' },
      ),
    ).toEqual({})
  })
})
