import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// rn-svg transform.js stub: provides ESM `parse` export so extractTransform.js
// can `import { parse } from './transform'`. The original module is PEG.js-
// generated CJS using `module.exports` without ES named exports, which Vite's
// dev server (native browser ESM) cannot interop. We use a `load` hook because
// Vite resolves the relative `./transform` import to an absolute filesystem
// path before plugins run; on Windows that path uses backslashes, so we
// normalize to forward slashes before matching. SWI Design System components
// don't use SVG transforms, so a no-op `parse` is safe.
const stubRnSvgTransform = (): Plugin => ({
  name: 'stub-rn-svg-transform',
  enforce: 'pre',
  load(id: string) {
    const normalized = id.replace(/\\/g, '/')
    if (
      normalized.endsWith(
        '/react-native-svg/lib/module/lib/extract/transform.js',
      )
    ) {
      return 'export const parse = () => null; export default { parse: () => null };'
    }
    return null
  },
})

export default defineConfig({
  plugins: [react(), stubRnSvgTransform()],
  resolve: {
    alias: [
      // rn-svg's entire Fabric directory: stub on web (depends on RN internals).
      {
        find: /^react-native-svg\/lib\/module\/fabric\//,
        replacement: path.resolve(__dirname, './src/stubs/empty-fabric.ts'),
      },
      // rn-svg's Fabric components import this RN deep path; stub it on web.
      {
        find: /^react-native\/Libraries\/Utilities\/codegenNativeComponent$/,
        replacement: path.resolve(__dirname, './src/stubs/codegenNativeComponent.ts'),
      },
      // Map bare `react-native` to RN-Web with absolute path for esbuild.
      {
        find: /^react-native$/,
        replacement: path.resolve(__dirname, './node_modules/react-native-web'),
      },
      // Project alias.
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.js'],
  },
  optimizeDeps: {
    include: ['react-native-web', 'styled-components'],
    exclude: ['react-native-svg'],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
})
