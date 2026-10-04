// Mapa pequeno do formulário de câmera: um clique marca a posição, e o pino
// de câmera do DS mostra onde ela ficou. Ninguém digita coordenada.
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import type * as maplibregl from 'maplibre-gl'
import { LocationPin, Text, useTheme } from '@kavicki/swi-design-system'
import { useMapLibre } from '@/lib/useMapLibre'
import { SATELLITE_STYLE } from '@/lib/mapStyles'
import { createPinElement, type PinElement } from '@/lib/pinFactory'

export type LatLng = { lat: number; lng: number }

// Seis casas decimais são cerca de 10 cm: mais que isso é ruído do clique.
const round = (n: number) => Math.round(n * 1e6) / 1e6

export function PositionPicker({
  value,
  center,
  onChange,
  error,
}: {
  value: LatLng | null
  /** Onde o mapa abre quando ainda não há posição marcada, como [lng, lat]. */
  center: [number, number]
  onChange: (next: LatLng) => void
  error?: string
}) {
  const theme = useTheme()
  const lib = useMapLibre()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const pinRef = useRef<(PinElement & { marker: maplibregl.Marker }) | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // O mapa nasce uma vez, no ponto de partida; marcar outra posição só move o pino.
  const initialRef = useRef(value)

  useEffect(() => {
    if (!lib || !containerRef.current) return
    const start = initialRef.current
    const map = new lib.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: start ? [start.lng, start.lat] : center,
      zoom: start ? 17 : 14,
      attributionControl: false,
    })
    map.getCanvas().style.cursor = 'crosshair'
    map.on('click', (e: maplibregl.MapMouseEvent) => {
      onChangeRef.current({ lat: round(e.lngLat.lat), lng: round(e.lngLat.lng) })
    })
    mapRef.current = map
    return () => {
      const pin = pinRef.current
      pinRef.current = null
      if (pin) {
        pin.marker.remove()
        // Desmontar dentro do render dispara aviso do React 18: adia para depois.
        queueMicrotask(() => {
          pin.root.unmount()
          pin.el.remove()
        })
      }
      map.remove()
      mapRef.current = null
    }
    // `center` só vale para o primeiro enquadramento: mudar depois não recria o mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib])

  useEffect(() => {
    const map = mapRef.current
    if (!lib || !map || !value) return
    if (pinRef.current) {
      pinRef.current.marker.setLngLat([value.lng, value.lat])
      return
    }
    const { el, root } = createPinElement({
      onClick: () => {},
      content: <LocationPin variant="camera" />,
    })
    const marker = new lib.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([value.lng, value.lat])
      .addTo(map)
    pinRef.current = { el, root, marker }
  }, [lib, value])

  return (
    <View style={{ gap: theme.gap.xs }}>
      <Text variant="body.s" weight="bold" color={theme.content.dark}>
        Posição
      </Text>
      <View
        style={{
          height: 240,
          borderRadius: theme.border.radius.m,
          overflow: 'hidden',
          backgroundColor: theme.surface.medium,
        }}
      >
        <div
          ref={containerRef}
          data-testid="camera-form-map"
          aria-label="Mapa: clique onde a câmera está instalada"
          style={{ width: '100%', height: '100%' }}
        />
      </View>
      <Text testID="camera-form-position" variant="body.s" color={theme.content.dark}>
        {value
          ? `Marcada em ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}. Clique de novo para mover.`
          : 'Clique no mapa onde a câmera está instalada.'}
      </Text>
      {error ? (
        <Text variant="body.s" color={theme.content.error}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}
