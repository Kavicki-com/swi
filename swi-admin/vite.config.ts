import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // rn-svg's extractTransform imports `parse` from a PEG.js CJS module
      // (`./transform`) via named ESM import. Vite dev's native ESM cannot
      // interop that shape, so stub it (SVG transforms are unused by SWI DS).
      // Anchored regex matches with or without the `.js` extension.
      {
        find: /^react-native-svg\/lib\/module\/lib\/extract\/extractTransform$/,
        replacement: path.resolve(__dirname, './src/stubs/empty-extract-transform.ts'),
      },
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
