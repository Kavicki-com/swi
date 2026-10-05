import { vi } from 'vitest'
import {
  BROWSER_NOTICE_BODY,
  BROWSER_NOTICE_TITLE,
  PREFERENCE_KEY,
  browserNoticeSupport,
  browserNoticesEnabled,
  disableBrowserNotices,
  requestBrowserNotices,
  showUrgentBrowserNotice,
} from './browserNotifications'

type Shown = {
  title: string
  options: NotificationOptions
  close: () => void
  onclick: (() => void) | null
}

const fake = vi.hoisted(() => ({
  permission: 'default' as NotificationPermission,
  answer: 'granted' as NotificationPermission,
  shown: [] as Shown[],
  throws: false,
}))

class FakeNotification {
  static get permission() {
    return fake.permission
  }
  static requestPermission = vi.fn(async () => {
    fake.permission = fake.answer
    return fake.answer
  })
  onclick: (() => void) | null = null
  close = vi.fn()
  constructor(title: string, options: NotificationOptions) {
    if (fake.throws) throw new TypeError('Illegal constructor')
    fake.shown.push(this as unknown as Shown)
    Object.assign(this, { title, options })
  }
}

let visibility: DocumentVisibilityState = 'hidden'
let focused = false

beforeEach(() => {
  fake.permission = 'default'
  fake.answer = 'granted'
  fake.shown = []
  fake.throws = false
  FakeNotification.requestPermission.mockClear()
  vi.stubGlobal('Notification', FakeNotification)
  window.localStorage.clear()
  visibility = 'hidden'
  focused = false
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

const grantAndEnable = async () => {
  fake.answer = 'granted'
  await requestBrowserNotices()
}

describe('suporte e permissão', () => {
  it('sem a API no navegador, não há suporte', () => {
    vi.stubGlobal('Notification', undefined)
    expect(browserNoticeSupport()).toBe('unsupported')
  })

  it('repete a permissão do navegador', () => {
    fake.permission = 'denied'
    expect(browserNoticeSupport()).toBe('denied')
  })

  it('pedir e receber permissão liga os avisos', async () => {
    expect(await requestBrowserNotices()).toBe('granted')
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
    expect(browserNoticesEnabled()).toBe(true)
    expect(window.localStorage.getItem(PREFERENCE_KEY)).toBe('on')
  })

  it('negar deixa desligado', async () => {
    fake.answer = 'denied'
    expect(await requestBrowserNotices()).toBe('denied')
    expect(browserNoticesEnabled()).toBe(false)
  })

  it('com a permissão já dada, ligar não pergunta de novo', async () => {
    fake.permission = 'granted'
    await requestBrowserNotices()
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
    expect(browserNoticesEnabled()).toBe(true)
  })

  it('pedido que falha no navegador não quebra nem muda a escolha', async () => {
    FakeNotification.requestPermission.mockImplementationOnce(() =>
      Promise.reject(new Error('falhou')),
    )
    expect(await requestBrowserNotices()).toBe('default')
    expect(window.localStorage.getItem(PREFERENCE_KEY)).toBeNull()
  })

  it('desligar guarda a escolha mesmo com a permissão dada', async () => {
    await grantAndEnable()
    disableBrowserNotices()
    expect(browserNoticesEnabled()).toBe(false)
    expect(window.localStorage.getItem(PREFERENCE_KEY)).toBe('off')
  })
})

describe('showUrgentBrowserNotice', () => {
  it('com a aba escondida mostra o aviso sem nome nem condição', async () => {
    await grantAndEnable()
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(true)
    expect(fake.shown).toHaveLength(1)
    const shown = fake.shown[0]!
    expect(shown.title).toBe(BROWSER_NOTICE_TITLE)
    expect(shown.options.body).toBe(BROWSER_NOTICE_BODY)
    expect(shown.options.tag).toBe('swi-alerta-a1')
    expect(shown.options.requireInteraction).toBe(true)
    expect(BROWSER_NOTICE_TITLE).toBe('Alerta urgente no SWI')
    expect(BROWSER_NOTICE_BODY).toBe(
      'Um funcionário precisa de atenção. Clique para abrir o painel.',
    )
  })

  it('com a aba visível mas sem foco também mostra', async () => {
    await grantAndEnable()
    visibility = 'visible'
    focused = false
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(true)
  })

  it('com a aba na frente e em foco não mostra: o aviso do painel basta', async () => {
    await grantAndEnable()
    visibility = 'visible'
    focused = true
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(false)
    expect(fake.shown).toHaveLength(0)
  })

  // Duas abas do painel: a que está na frente marca o alerta, e a escondida
  // não notifica enquanto o admin olha a outra.
  it('a aba na frente marca o alerta, e a escondida não repete', async () => {
    await grantAndEnable()
    visibility = 'visible'
    focused = true
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(false)
    visibility = 'hidden'
    focused = false
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(false)
    expect(fake.shown).toHaveLength(0)
  })

  it('marca corrompida no armazenamento é descartada', async () => {
    await grantAndEnable()
    window.localStorage.setItem('swi.admin.browserNotice.a1', 'lixo')
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(true)
  })

  it('desligado ou sem permissão não mostra', async () => {
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(false)
    await grantAndEnable()
    disableBrowserNotices()
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(false)
  })

  it('o mesmo alerta não aparece de novo, nem vindo de outra aba', async () => {
    await grantAndEnable()
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(true)
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(false)
    expect(fake.shown).toHaveLength(1)
  })

  it('vários alertas na mesma leitura viram um aviso só', async () => {
    await grantAndEnable()
    expect(showUrgentBrowserNotice(['a2', 'a1'], vi.fn())).toBe(true)
    expect(fake.shown).toHaveLength(1)
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(false)
  })

  it('clicar foca a aba, abre o monitoramento e fecha o aviso', async () => {
    await grantAndEnable()
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const open = vi.fn()
    showUrgentBrowserNotice(['a1'], open)
    const shown = fake.shown[0]!
    shown.onclick!()
    expect(focus).toHaveBeenCalled()
    expect(open).toHaveBeenCalled()
    expect(shown.close).toHaveBeenCalled()
  })

  it('armazenamento bloqueado não impede o aviso', async () => {
    await grantAndEnable()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(true)
  })

  // Por último: o construtor recusado marca o navegador como sem suporte até a
  // página recarregar, e isso valeria para os testes seguintes.
  it('navegador que recusa o construtor (Chrome do Android) não quebra', async () => {
    await grantAndEnable()
    fake.throws = true
    expect(showUrgentBrowserNotice(['a1'], vi.fn())).toBe(false)
    expect(browserNoticeSupport()).toBe('unsupported')
  })
})
