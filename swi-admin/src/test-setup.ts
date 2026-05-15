import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Force jsdom's documentElement to report a real desktop viewport.
// react-native-web's Dimensions polyfill reads `documentElement.clientWidth/Height`
// (see node_modules/react-native-web/dist/cjs/exports/Dimensions/index.js),
// which jsdom otherwise reports as 0 because it doesn't run CSS layout.
// 1366×768 is the canonical Figma frame and falls inside the 'desktop'
// breakpoint class, so existing AppLayout/Dashboard tests render the
// desktop path by default. Per-test overrides go through vi.mock on the
// useWindowDimensions export from 'react-native'.
if (typeof document !== 'undefined') {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    get: () => 1366,
  })
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    get: () => 768,
  })
}

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
