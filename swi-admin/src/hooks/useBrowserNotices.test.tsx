import { vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useBrowserNotices } from './useBrowserNotices'

const fake = vi.hoisted(() => ({ permission: 'default' as NotificationPermission }))

class FakeNotification {
  static get permission() {
    return fake.permission
  }
  static requestPermission = vi.fn(async () => {
    fake.permission = 'granted'
    return 'granted' as NotificationPermission
  })
}

beforeEach(() => {
  fake.permission = 'default'
  vi.stubGlobal('Notification', FakeNotification)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('useBrowserNotices', () => {
  it('antes de o navegador responder, está desligado e pode pedir', () => {
    const { result } = renderHook(() => useBrowserNotices())
    expect(result.current.support).toBe('default')
    expect(result.current.enabled).toBe(false)
  })

  it('pedir e receber liga, e a tela vê na hora', async () => {
    const { result } = renderHook(() => useBrowserNotices())
    await act(async () => {
      await result.current.request()
    })
    expect(result.current.support).toBe('granted')
    expect(result.current.enabled).toBe(true)
  })

  it('desligar a preferência desliga, com a permissão mantida', async () => {
    fake.permission = 'granted'
    const { result } = renderHook(() => useBrowserNotices())
    expect(result.current.enabled).toBe(true)
    act(() => result.current.disable())
    expect(result.current.enabled).toBe(false)
    expect(result.current.support).toBe('granted')
  })

  it('quem fechou o pedido sem responder conta como recusa, para o sino parar de oferecer', async () => {
    FakeNotification.requestPermission.mockImplementationOnce(async () => 'default')
    const { result } = renderHook(() => useBrowserNotices())
    expect(result.current.declined).toBe(false)
    await act(async () => {
      await result.current.request()
    })
    expect(result.current.support).toBe('default')
    expect(result.current.declined).toBe(true)
  })

  it('permissão trocada nas configurações do navegador aparece quando a aba volta ao foco', () => {
    const { result } = renderHook(() => useBrowserNotices())
    fake.permission = 'denied'
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current.support).toBe('denied')
  })
})
