import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Use the web polyfill of react-native-svg.
      {
        find: /^react-native-svg$/,
        replacement: path.resolve(__dirname, './node_modules/react-native-svg-web'),
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
  server: {
    fs: {
      allow: [path.resolve(__dirname)],
    },
    // QA remoto (cliente/QA acessando o painel de fora): o dev server do Vite
    // recusa Host desconhecido com "Blocked request. This host is not
    // allowed." — proteção contra DNS rebinding. Liberamos os SUFIXOS dos
    // provedores de túnel em vez das URLs, que mudam a cada sessão do agente.
    // Só afeta `vite dev`; o build de produção não tem host check.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.dev', '.ngrok-free.app'],
  },
  optimizeDeps: {
    include: ['react-native-web', 'styled-components', 'styled-components/native'],
  },
  build: {
    // styled-components/native ships ESM files containing literal
    // require("react-native") calls (mixed-module bug). Without this flag,
    // Rollup leaves those requires in the output and the browser throws
    // "require is not defined". Setting it true forces the commonjs plugin
    // to also process require() inside ESM files so the alias above can
    // rewrite "react-native" -> "react-native-web" in the bundle.
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        // As dependências que TODA rota usa (inclusive o /login) somavam 728 kB
        // dentro do chunk da aplicação, contra 246 kB de código nosso. Sem
        // separá-las, nenhum React.lazy tiraria o bundle inicial do aviso de
        // 500 kB, porque o peso não está nas páginas.
        //
        // Três grupos por fronteira real de biblioteca, e não um vendor único:
        // um bloco só ficaria em 728 kB e continuaria acima do limite. Assim
        // nenhum passa de ~270 kB, e cada um tem seu próprio ritmo de troca, o
        // que preserva o cache do navegador entre deploys.
        //
        // maplibre-gl fica de fora: já vem por import() dinâmico em
        // lib/useMapLibre e ganha chunk próprio sozinho.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-react-native': ['react-native-web', 'react-native-svg-web'],
          'vendor-design-system': ['@kavicki/swi-design-system', 'styled-components'],
        },
      },
    },
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
})
