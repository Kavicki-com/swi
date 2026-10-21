// Pino do ponto de encontro da evacuação: o mesmo glifo que o app mostra no
// destino da rota, para o gestor reconhecer na hora o que o trabalhador vê.
// Serve o rascunho (passo de marcar) e o ponto salvo da evacuação ativa.
import type * as maplibregl from 'maplibre-gl'
import { LocationPin } from '@kavicki/swi-design-system'
import { createPinElement } from '@/lib/pinFactory'
import type { AreaVertex } from '@/lib/evacuationArea'

export const MUSTER_PIN_NAME = 'Ponto de encontro'

const MUSTER_PIN_SIZE = 40

/**
 * Pendura o pino do ponto de encontro e devolve um disposer. O desmonte da
 * raiz React vai pra microtask, como nos pinos de câmera: chamar unmount()
 * dentro do cleanup, no meio de um render, derruba a rota com aviso do React.
 */
export function buildMusterPin(
  point: AreaVertex,
  map: maplibregl.Map,
  lib: typeof maplibregl,
): () => void {
  const { el, root } = createPinElement({
    // O pino não é clicável: só mostra onde o ponto está.
    onClick: () => {},
    content: (
      <LocationPin variant="badge" status="alert" size={MUSTER_PIN_SIZE} name={MUSTER_PIN_NAME} />
    ),
    title: MUSTER_PIN_NAME,
  })
  const marker = new lib.Marker({ element: el }).setLngLat(point).addTo(map)
  return () => {
    marker.remove()
    queueMicrotask(() => {
      root.unmount()
      el.remove()
    })
  }
}
