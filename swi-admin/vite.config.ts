import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
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
    // Pre-bundle rn-svg so esbuild handles CJS-ESM interop for its PEG.js-generated
    // transform.js (CommonJS) being imported via named ESM import in extractTransform.js.
    // Fabric paths are aliased to stubs above, so pre-bundling won't pull in RN internals.
    include: ['react-native-web', 'styled-components', 'react-native-svg'],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
})
