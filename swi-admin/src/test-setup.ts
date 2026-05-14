import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock maplibre-gl: it requires WebGL/canvas which jsdom doesn't provide.
// Tests don't render the map visually; they just need the module to load.
vi.mock('maplibre-gl', () => {
  class Map {
    on() {
      return this
    }
    off() {
      return this
    }
    addControl() {
      return this
    }
    fitBounds() {
      return this
    }
    setCenter() {
      return this
    }
    remove() {}
  }
  class Marker {
    setLngLat() {
      return this
    }
    addTo() {
      return this
    }
    remove() {}
  }
  class LngLatBounds {
    extend() {
      return this
    }
  }
  const ns = { Map, Marker, LngLatBounds }
  return { default: ns, ...ns }
})

// CSS import side-effect — return empty so vite-node doesn't try to load real CSS.
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))
