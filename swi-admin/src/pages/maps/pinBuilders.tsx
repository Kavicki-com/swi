// src/pages/maps/pinBuilders.tsx
// Fábricas de pino do mapa. Extraídas de MapsGeneral.tsx sem mudança de
// comportamento: cada uma monta um LocationPin do DS dentro de um elemento
// solto e o pendura como maplibregl.Marker.
import type * as maplibregl from 'maplibre-gl'
import { LocationPin } from '@kavicki/swi-design-system'
import { createPinElement, type PinElement } from '@/lib/pinFactory'
import { type DashboardMapMarker } from '@/services/dashboard'
import { type Camera } from '@/services/api/cameras'

export type PinHandle = PinElement & { marker: maplibregl.Marker }

// Pino de quem o mapa foi aberto para mostrar: maior que os 40 px padrão do DS.
const FOCUSED_PIN_SIZE = 56

export function buildPin(
  m: DashboardMapMarker,
  map: maplibregl.Map,
  lib: typeof maplibregl,
  onClick: () => void,
  title?: string,
  { focused = false }: { focused?: boolean } = {},
): PinHandle {
  const { el, root } = createPinElement({
    onClick,
    content: (
      <LocationPin
        avatarUri={m.avatarUri}
        status={m.status}
        name={m.name}
        size={focused ? FOCUSED_PIN_SIZE : undefined}
      />
    ),
    title,
  })
  // Pino em foco por cima dos vizinhos, senão some atrás de quem está perto.
  if (focused) el.style.zIndex = '1'
  const marker = new lib.Marker({ element: el }).setLngLat([m.lng, m.lat]).addTo(map)
  return { marker, root, el }
}

// Ponto de câmera cadastrado (GET /cameras), a MESMA fonte do KPI "Câmeras ativas".
export function buildCameraPin(
  c: Camera,
  map: maplibregl.Map,
  lib: typeof maplibregl,
  onClick: () => void,
): PinHandle {
  const { el, root } = createPinElement({
    onClick,
    content: <LocationPin variant="camera" name={c.name} />,
  })
  const marker = new lib.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map)
  return { marker, root, el }
}
