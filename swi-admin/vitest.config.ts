import path from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Absolute paths in the host's node_modules so Node's createRequire resolves them
// regardless of the file's own location (the DS is linked from outside swi-admin).
const HOST_REACT_NATIVE_WEB = path
  .resolve(__dirname, './node_modules/react-native-web')
  .replace(/\\/g, '/')
const HOST_REACT = path.resolve(__dirname, './node_modules/react').replace(/\\/g, '/')

/**
 * Vite plugin: rewrite literal `require()` calls inside the styled-components/native
 * bundle the DS pulls in.
 *
 * Why: the DS bundle uses styled-components/native, whose CJS/ESM output contains
 * literal `require("react-native")` and `require("react")` calls. When vite-node
 * executes the file, those calls go through Node's native `createRequire`, which
 * bypasses Vite's resolve aliases. Result:
 *   - `require("react-native")` pulls the real react-native (Flow syntax → parse fail)
 *   - `require("react")` pulls a *second* React from swi-design-system/node_modules,
 *     so useContext returns null (two-React dispatcher mismatch).
 *
 * Rewriting the literals to absolute paths in the host's node_modules forces both
 * to resolve to the host's copies regardless of where the DS bundle lives.
 */
const rewriteStyledNativeRequires = {
  name: 'rewrite-styled-native-requires',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.includes('styled-components') || !id.includes('native')) return null
    let next = code
    next = next.replace(/require\(["']react-native["']\)/g, `require("${HOST_REACT_NATIVE_WEB}")`)
    next = next.replace(/require\(["']react["']\)/g, `require("${HOST_REACT}")`)
    if (next === code) return null
    return { code: next, map: null }
  },
}

export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [rewriteStyledNativeRequires],
    resolve: {
      // Force a single React copy across host (swi-admin) and DS (linked file:../..).
      // Without this, the DS bundle resolves react from its own node_modules and
      // we get "Cannot read properties of null (reading 'useContext')" because two
      // React instances don't share the dispatcher.
      dedupe: ['react', 'react-dom'],
      alias: [
        {
          find: /^react$/,
          replacement: path.resolve(__dirname, './node_modules/react'),
        },
        {
          find: /^react-dom$/,
          replacement: path.resolve(__dirname, './node_modules/react-dom'),
        },
      ],
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      css: false,
      // Single-fork execution. Each test file imports the DS bundle and a
      // jsdom instance; with 30+ test files the default worker pool exhausts
      // Node's heap on Windows (memory allocation failures + worker exits).
      // Sequential single-fork is ~3× slower but stable.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      coverage: {
        // istanbul, não v8: o provider v8 lê a cobertura pelo inspector do
        // processo, e com `pool: 'forks'` + `singleFork` ele perde a sessão
        // depois do primeiro arquivo ("Session is not connected",
        // ERR_INSPECTOR_NOT_CONNECTED) e aborta o run inteiro. O istanbul
        // instrumenta no transform e não depende do inspector.
        provider: 'istanbul',
        reporter: ['text', 'json-summary'],
        // Toda a árvore de produção entra no denominador. Sem `include`, o v8
        // só conta arquivo que algum teste importou, e o número sai inflado
        // porque módulo sem teste nenhum simplesmente não aparece.
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.d.ts',
          'src/**/*.test.{ts,tsx}',
          'src/**/*.stories.{ts,tsx}',
          'src/**/*.testKit.tsx',
          'src/test-setup.ts',
          'src/main.tsx',
        ],
        // Portão travado: a cobertura só sobe daqui. Vale para as quatro
        // métricas porque cada uma pega uma lacuna diferente — `functions`
        // denuncia caminho de código nunca chamado, `branches` denuncia
        // condição nunca exercitada, e nenhuma das duas aparece em `lines`.
        thresholds: {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
      server: {
        deps: {
          // Force packages that depend on react-native/styled-components/native through
          // Vite's transform so the rn → rn-web aliases apply during tests.
          // Without this, vite-node's native loader pulls real react-native (Flow syntax → parse fail).
          inline: true,
        },
      },
    },
  }),
)
