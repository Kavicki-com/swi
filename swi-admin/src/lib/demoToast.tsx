// src/lib/demoToast.tsx
// Demo-mode toast — fires a brief "Ação registrada" Toast when a button
// fires that doesn't yet have a real mock-API handler. Lets the client
// browse the demo feeling that every click reacts, instead of staring at
// dead buttons. Production replaces these stub calls with real handlers.
//
// Mount <DemoToastProvider> once at app root (App.tsx). Inside any page:
//   const { show } = useDemoToast()
//   <Button onPress={() => show()} />                  // default title
//   <Button onPress={() => show('Filtro aplicado')} /> // custom title
//   <Button onPress={() => show('Relatório', 'Gerado com sucesso')} />
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Toast } from '@kavicki/swi-design-system'

type ToastState = { id: number; title: string; message?: string }

type DemoToastContextValue = {
  show: (title?: string, message?: string) => void
}

const DemoToastContext = createContext<DemoToastContextValue | null>(null)

const AUTO_DISMISS_MS = 2500

export function DemoToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setToast(null)
  }, [])

  const show = useCallback((title = 'Ação registrada', message?: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ id: Date.now(), title, message })
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setToast(null)
    }, AUTO_DISMISS_MS)
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return (
    <DemoToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            pointerEvents: 'auto',
          }}
        >
          <Toast
            variant="info"
            title={toast.title}
            message={toast.message}
            onClose={dismiss}
            testID="demo-toast"
            accessibilityLabel={toast.title}
          />
        </div>
      ) : null}
    </DemoToastContext.Provider>
  )
}

export function useDemoToast(): DemoToastContextValue {
  const ctx = useContext(DemoToastContext)
  if (!ctx) {
    // Soft fallback: pages might mount in isolated test envs without the
    // provider. Return a no-op so calls don't crash; production-mode pages
    // are always wrapped at App.tsx so this branch is only hit by tests.
    return { show: () => {} }
  }
  return ctx
}
