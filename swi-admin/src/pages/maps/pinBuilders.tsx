// src/pages/maps/pinBuilders.tsx
// Fábricas de pino do mapa. Extraídas de MapsGeneral.tsx sem mudança de
// comportamento: cada uma monta um LocationPin do DS dentro de um elemento
// solto e o pendura como maplibregl.Marker.
import type maplibregl from 'maplibre-gl'
import { LocationPin } from '@kavicki/swi-design-system'
import { createPinElement, type PinElement } from '@/lib/pinFactory'
import { type DashboardMapMarker } from '@/services/dashboard'
import { type CameraLocation } from '@/services/cameras'

export type PinHandle = PinElement & { marker: maplibregl.Marker }

export function buildPin(
  m: DashboardMapMarker,
  map: maplibregl.Map,
  lib: typeof maplibregl,
  onClick: () => void,
): PinHandle {
  const { el, root } = createPinElement({
    onClick,
    content: <LocationPin avatarUri={m.avatarUri} status={m.status} name={m.name} />,
  })
  const marker = new lib.Marker({ element: el }).setLngLat([m.lng, m.lat]).addTo(map)
  return { marker, root, el }
}

// Frota de câmeras: importada de services/cameras — a MESMA lista que alimenta
// o KPI "Câmeras ativas" (antes o mapa desenhava 12 e o KPI cravava 564).

export function buildCameraPin(
  c: CameraLocation,
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
