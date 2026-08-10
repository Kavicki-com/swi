import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertNoCollisions,
  classify,
  deliveryPath,
  manifestPath,
  normalizeText,
} from './policy.mjs'

// ---------------------------------------------------------------------------
// Mapeamento de caminho: literal e reversível, um único sufixo .txt.
// ---------------------------------------------------------------------------

test('preserva a árvore e acrescenta .txt', () => {
  assert.equal(deliveryPath('mobile/app/index.tsx'), 'data/mobile/app/index.tsx.txt')
  assert.equal(deliveryPath('mobile/NOTICE.txt'), 'data/mobile/NOTICE.txt.txt')
})

test('recusa caminho absoluto ou traversal', () => {
  assert.throws(() => deliveryPath('../secret.env'))
  assert.throws(() => deliveryPath('C:/secret.env'))
  assert.throws(() => deliveryPath('/etc/passwd'))
  assert.throws(() => deliveryPath('mobile/../../secret.env'))
})

// ---------------------------------------------------------------------------
// Classificação: allowlist explícita, nada entra por omissão.
// ---------------------------------------------------------------------------

test('inclui texto e template de ambiente', () => {
  assert.equal(classify('swi-backend/src/main.ts'), 'payload-text')
  assert.equal(classify('swi-backend/.env.example'), 'payload-text')
  assert.equal(classify('mobile/assets/icon.svg'), 'payload-text')
})

test('inclui teste, migration, schema, manifest, lockfile e config textual', () => {
  assert.equal(classify('mobile/__tests__/app/dashboard.test.tsx'), 'payload-text')
  assert.equal(classify('swi-backend/prisma/migrations/0_init/migration.sql'), 'payload-text')
  assert.equal(classify('swi-backend/prisma/schema.prisma'), 'payload-text')
  assert.equal(classify('swi-admin/package.json'), 'payload-text')
  assert.equal(classify('swi-admin/package-lock.json'), 'payload-text')
  assert.equal(classify('mobile/.gitignore'), 'payload-text')
  assert.equal(classify('swi-backend/docker-compose.e2e.yml'), 'payload-text')
  assert.equal(classify('swi-backend/Dockerfile'), 'payload-text')
})

test('exclui valores, legado, documentação e artefatos', () => {
  assert.equal(classify('swi-admin/.env.production'), 'excluded-env')
  assert.equal(classify('swi-backend/amplify/auth/resource.ts'), 'excluded-legacy')
  assert.equal(classify('docs/plans/a.md'), 'excluded-docs')
  assert.equal(classify('mobile/dist/index.html'), 'excluded-build')
})

test('exclui .git, node_modules, caches e relatórios de teste', () => {
  assert.equal(classify('mobile/node_modules/react/index.js'), 'excluded-build')
  assert.equal(classify('swi-admin/coverage/index.html'), 'excluded-build')
  assert.equal(classify('swi-admin/test-results/x.json'), 'excluded-build')
  assert.equal(classify('swi-admin/playwright-report/index.html'), 'excluded-build')
  assert.equal(classify('mobile/.expo/settings.json'), 'excluded-build')
})

test('exclui o que está fora das três raízes da entrega', () => {
  assert.equal(classify('scripts/e2e/run-test-stack.mjs'), 'excluded-scope')
  assert.equal(classify('.github/workflows/ci.yml'), 'excluded-scope')
  assert.equal(classify('.gitleaks.toml'), 'excluded-scope')
})

test('markdown dentro das raízes é documentação, não código', () => {
  assert.equal(classify('mobile/README.md'), 'excluded-docs')
})

test('vendor não entra no payload nem é aberto', () => {
  assert.equal(classify('swi-admin/vendor/swi-design-system-0.1.132.tgz'), 'excluded-vendor')
})

test('inventaria binário funcional sem transformá-lo', () => {
  assert.equal(classify('mobile/assets/icon.png'), 'binary-inventory')
  assert.equal(classify('mobile/assets/fonts/Inter-Regular.ttf'), 'binary-inventory')
})

test('extensão desconhecida cai no inventário, nunca entra em silêncio', () => {
  assert.equal(classify('mobile/assets/misterio.bin'), 'binary-inventory')
})

// ---------------------------------------------------------------------------
// Manifesto BagIt: percent-encode só no caminho do manifesto.
// ---------------------------------------------------------------------------

test('codifica caracteres reservados somente no caminho do manifesto', () => {
  assert.equal(manifestPath('data/mobile/100%.ts.txt'), 'data/mobile/100%25.ts.txt')
  assert.equal(manifestPath('data/mobile/a\nb.ts.txt'), 'data/mobile/a%0Ab.ts.txt')
  assert.equal(manifestPath('data/mobile/a\rb.ts.txt'), 'data/mobile/a%0Db.ts.txt')
  assert.equal(manifestPath('data/mobile/simples.ts.txt'), 'data/mobile/simples.ts.txt')
})

// ---------------------------------------------------------------------------
// Detecção de texto: rejeitar o que não é UTF-8 e normalizar o que é.
// ---------------------------------------------------------------------------

test('normaliza BOM, CRLF e CR isolado para UTF-8 sem BOM com LF', () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x63])
  assert.equal(normalizeText(bom), 'a\nb\nc')
})

test('rejeita NUL e UTF-8 inválido', () => {
  assert.throws(() => normalizeText(Buffer.from([0x61, 0x00, 0x62])), /NUL/)
  assert.throws(() => normalizeText(Buffer.from([0xff, 0xfe, 0x61])), /UTF-8/)
})

// ---------------------------------------------------------------------------
// Colisões: abortar, nunca escolher em silêncio.
// ---------------------------------------------------------------------------

test('aborta em colisão case-insensitive ou Unicode-normalizada', () => {
  assert.throws(() => assertNoCollisions(['mobile/App.tsx', 'mobile/app.tsx']), /mobile\/App\.tsx/)
  // 'é' precomposto (U+00E9) contra 'e' + combining acute (U+0301): mesmo NFC.
  assert.throws(() => assertNoCollisions(['mobile/caf\u00e9.ts', 'mobile/cafe\u0301.ts']))
  assert.doesNotThrow(() => assertNoCollisions(['mobile/a.ts', 'mobile/b.ts']))
})
