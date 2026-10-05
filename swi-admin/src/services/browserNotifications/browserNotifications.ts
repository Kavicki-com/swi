// Notificação do sistema operacional pela Notification API do navegador, sem
// service worker: funciona com a aba escondida, minimizada ou atrás de outra
// janela, mas só enquanto a aba está aberta.
//
// Regras do painel:
// - Só para alerta urgente novo, e só com a aba escondida ou sem foco: com a
//   aba na frente, o aviso do próprio painel basta.
// - Sem nome nem condição no texto: a notificação aparece na central do
//   sistema, fora do painel, à vista de quem passar pela tela.
// - Permissão só por clique do admin (Firefox e Safari recusam fora de um
//   clique) e preferência guardada no navegador.
// - Com várias abas abertas, a primeira que marcar o alerta decide: a que está
//   na frente marca e não mostra, a escondida marca e mostra. A marca vive no
//   armazenamento comum às abas e não é atômica: duas abas que reagem ao mesmo
//   aviso na mesma fração de segundo podem mostrar as duas; o `tag` por alerta
//   junta as duas no Chrome e no Firefox.

export const PREFERENCE_KEY = 'swi.admin.browserNotices'
const CLAIM_PREFIX = 'swi.admin.browserNotice.'
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000

export const BROWSER_NOTICE_TITLE = 'Alerta urgente no SWI'
export const BROWSER_NOTICE_BODY = 'Um funcionário precisa de atenção. Clique para abrir o painel.'

/** Explicação em Configurações e no sino quando o navegador nega ou não tem a API. */
export const BROWSER_NOTICE_BLOCKED =
  'O navegador está bloqueando os avisos do SWI. Libere nas configurações do navegador.'
export const BROWSER_NOTICE_UNSUPPORTED = 'Este navegador não mostra avisos do SWI.'

export type BrowserNoticeSupport = 'unsupported' | NotificationPermission

// O Chrome do Android expõe a API, mas o construtor lança erro (lá só vale a
// notificação por service worker). Descoberto na primeira tentativa, vale até
// a página recarregar.
let constructorRefused = false
const listeners = new Set<() => void>()

const emit = () => {
  for (const l of [...listeners]) l()
}

const notificationApi = (): typeof Notification | null =>
  typeof Notification === 'undefined' || !Notification ? null : Notification

// O armazenamento pode estar bloqueado (janela privada, dados do site
// bloqueados): sem ele a preferência volta ao padrão e a marca entre abas não
// existe, mas o aviso continua.
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // sem armazenamento, segue sem guardar
  }
}

function forget(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // sem armazenamento, nada a apagar
  }
}

export function browserNoticeSupport(): BrowserNoticeSupport {
  const api = notificationApi()
  if (!api || constructorRefused) return 'unsupported'
  return api.permission
}

/** Permissão dada e preferência não desligada pelo admin. */
export function browserNoticesEnabled(): boolean {
  return browserNoticeSupport() === 'granted' && read(PREFERENCE_KEY) !== 'off'
}

/** Chamar só dentro de um clique: fora dele Firefox e Safari recusam o pedido. */
export async function requestBrowserNotices(): Promise<BrowserNoticeSupport> {
  const api = notificationApi()
  if (!api || constructorRefused) return 'unsupported'
  let answer: NotificationPermission
  try {
    answer = api.permission === 'default' ? await api.requestPermission() : api.permission
  } catch {
    // O navegador falhou ao perguntar: nada muda, e o admin pode tentar de novo.
    return api.permission
  }
  write(PREFERENCE_KEY, answer === 'granted' ? 'on' : 'off')
  emit()
  return answer
}

/** O admin desligou, negou ou fechou o pedido sem responder. */
export function browserNoticesDeclined(): boolean {
  return read(PREFERENCE_KEY) === 'off'
}

export function disableBrowserNotices(): void {
  write(PREFERENCE_KEY, 'off')
  emit()
}

/** Avisa quando a permissão ou a preferência mudam por aqui. */
export function subscribeBrowserNotices(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Marca cada alerta no armazenamento comum às abas; a que marcar primeiro
// mostra. Marcas com mais de um dia saem.
function claim(alertIds: string[], now: number): boolean {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i)
      if (!key?.startsWith(CLAIM_PREFIX)) continue
      const at = Number(read(key))
      // Marca corrompida também sai, senão nunca venceria.
      if (!Number.isFinite(at) || now - at > CLAIM_TTL_MS) forget(key)
    }
  } catch {
    // sem armazenamento, nada a limpar
  }
  let claimed = false
  for (const id of alertIds) {
    const key = `${CLAIM_PREFIX}${id}`
    if (read(key) !== null) continue
    write(key, String(now))
    claimed = true
  }
  return claimed
}

/**
 * Mostra uma notificação para os alertas urgentes novos de uma leitura (um aviso
 * só para todos). Devolve se mostrou.
 */
export function showUrgentBrowserNotice(alertIds: string[], onOpen: () => void): boolean {
  const api = notificationApi()
  const first = alertIds[0]
  if (!api || !first || !browserNoticesEnabled()) return false
  const inFront = document.visibilityState === 'visible' && document.hasFocus()
  if (!claim(alertIds, Date.now())) return false
  // Na frente, o aviso do próprio painel basta; a marca impede a outra aba,
  // escondida, de notificar enquanto o admin olha esta.
  if (inFront) return false
  try {
    const notice = new api(BROWSER_NOTICE_TITLE, {
      body: BROWSER_NOTICE_BODY,
      tag: `swi-alerta-${first}`,
      requireInteraction: true,
    })
    notice.onclick = () => {
      window.focus()
      onOpen()
      notice.close()
    }
    return true
  } catch {
    constructorRefused = true
    emit()
    return false
  }
}
