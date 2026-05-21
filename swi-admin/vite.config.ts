import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'

// Dev-only plugin: serves GET/POST /__fidelity/notes so the FidelityReview UI
// can sync user notes to disk under <worktree-root>/docs/audits/fidelity/.
// Disabled in production builds via apply: 'serve'.
const fidelityNotesPlugin = (): PluginOption => ({
  name: 'fidelity-notes',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__fidelity/notes', (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'POST') return next()

      const url = new URL(req.url ?? '/', 'http://x')
      const section = (req.method === 'GET' ? url.searchParams.get('section') : null) as
        | string
        | null

      const worktreeRoot = path.resolve(__dirname, '..')
      const notesDir = path.join(worktreeRoot, 'docs', 'audits', 'fidelity')

      const sendJson = (status: number, body: unknown) => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(body))
      }

      const safeSection = (s: unknown): string | null => {
        if (typeof s !== 'string') return null
        return /^[a-z0-9_-]+$/i.test(s) ? s : null
      }

      if (req.method === 'GET') {
        const safe = safeSection(section)
        if (!safe) return sendJson(400, { ok: false, error: 'invalid section' })
        const file = path.join(notesDir, `${safe}-notes.md`)
        if (!fs.existsSync(file)) return sendJson(200, { ok: true, content: '', exists: false })
        const content = fs.readFileSync(file, 'utf8')
        return sendJson(200, {
          ok: true,
          content,
          exists: true,
          path: path.relative(worktreeRoot, file).replace(/\\/g, '/'),
        })
      }

      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('error', (err) => sendJson(500, { ok: false, error: String(err?.message ?? err) }))
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8')
          const parsed = raw ? JSON.parse(raw) : {}
          const safe = safeSection(parsed.section)
          if (!safe) return sendJson(400, { ok: false, error: 'invalid section' })
          const content = typeof parsed.content === 'string' ? parsed.content : ''
          fs.mkdirSync(notesDir, { recursive: true })
          const file = path.join(notesDir, `${safe}-notes.md`)
          fs.writeFileSync(file, content, 'utf8')
          return sendJson(200, {
            ok: true,
            path: path.relative(worktreeRoot, file).replace(/\\/g, '/'),
            bytes: Buffer.byteLength(content, 'utf8'),
          })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          return sendJson(500, { ok: false, error: message })
        }
      })
    })
  },
})

// DEV ONLY: if a local clone of swi-design-system exists at ../../swi-design-system,
// alias `@kavicki/swi-design-system` to its source so edits there appear instantly via
// HMR (no rebuild, no `git push`, no version bump). Falls back to node_modules in CI.
const dsLocalRoot = path.resolve(__dirname, '../../swi-design-system')
const dsLocalEntry = path.join(dsLocalRoot, 'src', 'index.ts')
const useLocalDs = fs.existsSync(dsLocalEntry)
const dsLocalAlias = useLocalDs
  ? [{ find: /^@kavicki\/swi-design-system$/, replacement: dsLocalEntry }]
  : []
if (useLocalDs) {
  // eslint-disable-next-line no-console
  console.log(`[vite] @kavicki/swi-design-system → local source (${dsLocalRoot})`)
}

export default defineConfig({
  plugins: [react(), fidelityNotesPlugin()],
  resolve: {
    alias: [
      ...dsLocalAlias,
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
      // Allow vite to read the local DS clone outside the swi-admin root.
      allow: useLocalDs ? [path.resolve(__dirname), dsLocalRoot] : [path.resolve(__dirname)],
    },
  },
  optimizeDeps: {
    include: ['react-native-web', 'styled-components'],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
})
