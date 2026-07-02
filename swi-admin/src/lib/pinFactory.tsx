// Padrao compartilhado pra renderizar um componente React DS dentro de um
// maplibregl.Marker. maplibre so aceita HTMLElement, entao criamos um div
// destacado, montamos React nele com SwiThemeProvider (precisa porque esta
// fora da arvore principal), e devolvemos `el` + `root` pro caller anexar
// como Marker e limpar no useEffect cleanup. Importante: o root.unmount()
// deve ser deferido via queueMicrotask no caller (warning React 18).

import { createRoot, type Root } from 'react-dom/client'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import type { ReactNode } from 'react'

export type PinElement = { el: HTMLDivElement; root: Root }

export function createPinElement({
  onClick,
  content,
}: {
  onClick: () => void
  content: ReactNode
}): PinElement {
  const el = document.createElement('div')
  el.style.cursor = 'pointer'
  el.addEventListener('click', onClick)
  const root = createRoot(el)
  root.render(<SwiThemeProvider>{content}</SwiThemeProvider>)
  return { el, root }
}
