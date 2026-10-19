// src/app/staleChunkReload.ts
//
// Depois de um deploy, quem ainda tem o index.html antigo no navegador pede
// chunks que não existem mais: os nomes levam hash do conteúdo e o servidor
// responde 404. O import() do React.lazy rejeita e a tela fica preta, sem
// mensagem. O Vite avisa essa falha pelo evento `vite:preloadError`, e a
// resposta certa é recarregar a página, o que traz o index novo e os chunks
// que ele aponta.
//
// Recarrega UMA vez por janela: se o chunk continua faltando depois do reload,
// o problema não é cache, e recarregar de novo viraria um laço. A marca fica no
// sessionStorage, que sobrevive ao reload e morre com a aba. Sem storage
// utilizável (modo privado que o bloqueia), não recarrega: deixar o erro seguir
// é melhor do que arriscar o laço.
//
// O erro original segue sempre, sem `preventDefault`: cancelado, o `import()`
// resolve `undefined` e o `.then` que remapeia o export nomeado (App.tsx)
// quebraria com uma mensagem que não diz qual arquivo faltou. O reload já foi
// pedido antes de o erro se propagar, e, quando o reload não resolve, a
// mensagem que fica no console é a que aponta o chunk.

export const STALE_CHUNK_RELOAD_KEY = 'swi.admin.reloadPorChunk'
export const STALE_CHUNK_RELOAD_WINDOW_MS = 30_000

export type StaleChunkWindow = Pick<Window, 'addEventListener'> & {
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
  location: Pick<Location, 'reload'>
}

export function installStaleChunkReload(
  win: StaleChunkWindow = window,
  now: () => number = Date.now,
) {
  win.addEventListener('vite:preloadError', () => {
    const agora = now()
    try {
      // Sem marca nunca entra no `<`; marca ilegível vira NaN e também não entra.
      const marca = win.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)
      if (marca !== null && agora - Number(marca) < STALE_CHUNK_RELOAD_WINDOW_MS) return
      win.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(agora))
    } catch {
      return
    }
    win.location.reload()
  })
}
