// src/app/staleChunkReload.test.ts
// O que esta suíte afirma é o laço que NÃO pode existir: um chunk que falha
// recarrega a página uma vez, e uma segunda falha logo em seguida deixa o erro
// seguir em vez de recarregar de novo.
import { vi } from 'vitest'
import {
  installStaleChunkReload,
  STALE_CHUNK_RELOAD_KEY,
  STALE_CHUNK_RELOAD_WINDOW_MS,
  type StaleChunkWindow,
} from './staleChunkReload'

function janelaFalsa(storage: Partial<Pick<Storage, 'getItem' | 'setItem'>> = {}) {
  const alvo = new EventTarget()
  const dados = new Map<string, string>()
  const reload = vi.fn()
  const win = {
    addEventListener: alvo.addEventListener.bind(alvo),
    sessionStorage: {
      getItem: (chave: string) => dados.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        dados.set(chave, valor)
      },
      ...storage,
    },
    location: { reload },
  } as unknown as StaleChunkWindow
  // O evento real do Vite é cancelável. O helper nunca o cancela: é assim que
  // o erro original, com o nome do chunk, continua chegando ao console.
  const falhar = () => {
    const evento = new Event('vite:preloadError', { cancelable: true })
    alvo.dispatchEvent(evento)
    return evento
  }
  return { win, reload, falhar, dados }
}

describe('installStaleChunkReload', () => {
  it('na primeira falha recarrega, marca o momento e deixa o erro original seguir', () => {
    const { win, reload, falhar, dados } = janelaFalsa()
    installStaleChunkReload(win, () => 1_000)

    const evento = falhar()

    expect(evento.defaultPrevented).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(dados.get(STALE_CHUNK_RELOAD_KEY)).toBe('1000')
  })

  it('dentro da janela não recarrega de novo e deixa o erro seguir', () => {
    const { win, reload, falhar } = janelaFalsa()
    const relogio = vi
      .fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000 + STALE_CHUNK_RELOAD_WINDOW_MS - 1)
    installStaleChunkReload(win, relogio)

    falhar()
    const segundo = falhar()

    expect(segundo.defaultPrevented).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('passada a janela volta a recarregar', () => {
    const { win, reload, falhar } = janelaFalsa()
    const relogio = vi
      .fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000 + STALE_CHUNK_RELOAD_WINDOW_MS)
    installStaleChunkReload(win, relogio)

    falhar()
    falhar()

    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('sem storage utilizável não recarrega, para não virar laço', () => {
    const { win, reload, falhar } = janelaFalsa({
      getItem: () => {
        throw new Error('bloqueado')
      },
    })
    installStaleChunkReload(win, () => 1_000)

    const evento = falhar()

    expect(evento.defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
