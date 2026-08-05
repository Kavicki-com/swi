import '@testing-library/jest-dom'
// `beforeEach`/`afterEach` vêm dos globais (`globals: true` no vitest.config).
// Importá-los explicitamente AQUI registra os hooks fora de qualquer suíte e
// derruba a coleta inteira com "Vitest failed to find the current suite".
import { vi } from 'vitest'

// ---------------------------------------------------------------------------
// Portão de console.error
//
// Um `console.error` do React (tipicamente "update not wrapped in act(...)")
// significa que uma atualização de estado escapou do escopo do teste. O aviso
// é barato de ignorar e caro de diagnosticar depois: quando a atualização
// vaza, o React a atribui ao teste que estiver rodando NAQUELE momento, que
// quase nunca é o teste que a originou. Falhar aqui prende o problema.
//
// Testes que exercitam erro de propósito declaram a mensagem exata com
// `permitirConsoleError(/…/)`, e a permissão vale só para aquele teste.
// ---------------------------------------------------------------------------
// Ruído do AMBIENTE, não do código: o jsdom não implementa canvas, e qualquer
// gráfico do DS que peça um contexto 2D faz o jsdom gritar por console.error.
// Instalar o pacote `canvas` só para calar isso custaria uma dependência
// nativa em toda máquina e em CI, sem cobrir comportamento nenhum.
const RUIDO_DO_AMBIENTE: RegExp[] = [/Not implemented: HTMLCanvasElement/]

let permitidos: RegExp[] = []
let capturados: string[] = []

/** Libera mensagens de console.error esperadas pelo teste em execução. */
export function permitirConsoleError(...padroes: RegExp[]): void {
  permitidos.push(...padroes)
}

let espiao: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  permitidos = [...RUIDO_DO_AMBIENTE]
  capturados = []
  espiao = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    capturados.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  const inesperados = capturados.filter((m) => !permitidos.some((p) => p.test(m)))
  // Restauração defensiva: várias suítes chamam `vi.restoreAllMocks()` no
  // próprio afterEach, que roda ANTES deste e já desfaz o spy. Buscar o mock
  // de novo por `vi.mocked(console.error)` acharia a função original e
  // estouraria com "mockRestore is not a function".
  espiao?.mockRestore()
  espiao = null
  if (inesperados.length > 0) {
    throw new Error(
      `console.error inesperado durante o teste (${inesperados.length}):\n\n` +
        inesperados.join('\n---\n'),
    )
  }
})

// Force jsdom's documentElement to report a real desktop viewport.
// react-native-web's Dimensions polyfill reads `documentElement.clientWidth/Height`
// (see node_modules/react-native-web/dist/cjs/exports/Dimensions/index.js),
// which jsdom otherwise reports as 0 because it doesn't run CSS layout.
// 1366×768 is the canonical reference frame and falls inside the 'desktop'
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
