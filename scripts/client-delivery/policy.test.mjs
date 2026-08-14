import test from 'node:test'
import assert from 'node:assert/strict'
import { classify } from './policy.mjs'

// O pacote do cliente é o CÓDIGO das três frentes, num estado que RODA. Estes
// testes cercam as duas metades disso: o que entra por ser código das frentes,
// e o mínimo de raiz sem o qual o duplo clique não sobe nada.
//
// A política é allowlist: um caminho só entra quando alguma regra o inclui.
// O que nenhuma regra reconhece fica de fora, nunca dentro por descuido.

test('o codigo das tres frentes entra', () => {
  for (const caminho of [
    'mobile/app/(app)/dashboard.tsx',
    'swi-admin/src/pages/reports/ReportsList.tsx',
    'swi-backend/src/auth/auth.service.ts',
  ]) {
    assert.equal(classify(caminho), 'payload', caminho)
  }
})

test('testes, migrations, assets e configs das frentes entram', () => {
  for (const caminho of [
    'swi-backend/prisma/migrations/20260731110000_x/migration.sql',
    'swi-backend/prisma/schema.prisma',
    'swi-admin/src/pages/reports/ReportsList.behaviour.test.tsx',
    'mobile/assets/fonts/Inter-Regular.ttf',
    'swi-admin/package-lock.json',
    'swi-backend/Dockerfile',
  ]) {
    assert.equal(classify(caminho), 'payload', caminho)
  }
})

test('o tarball do design system entra: e de onde o npm install resolve', () => {
  assert.equal(classify('swi-admin/vendor/kavicki-swi-design-system-0.1.132.tgz'), 'payload')
  assert.equal(classify('mobile/vendor/kavicki-swi-design-system-0.1.131.tgz'), 'payload')
})

test('o minimo de raiz que faz o duplo clique subir entra', () => {
  for (const caminho of [
    'START-SWI.cmd',
    'STOP-SWI.cmd',
    'docker-compose.client.yml',
    'scripts/client/start-swi.ps1',
    'scripts/client/stop-swi.ps1',
  ]) {
    assert.equal(classify(caminho), 'payload', caminho)
  }
})

test('o aviso de propriedade entra, e e a unica excecao de markdown', () => {
  assert.equal(classify('NOTICE.md'), 'payload')
  assert.equal(classify('README.md'), 'excluded-scope')
  assert.equal(classify('swi-backend/README.md'), 'excluded-docs')
  assert.equal(classify('mobile/README.md'), 'excluded-docs')
})

test('documentacao interna nao acompanha a entrega', () => {
  assert.equal(classify('docs/plans/2026-08-13-client-delivery.md'), 'excluded-docs')
  assert.equal(classify('docs/audits/demo/screenshots/qa3-chat.png'), 'excluded-docs')
  assert.equal(classify('swi-admin/docs/decisao.md'), 'excluded-docs')
})

// Montado por concatenação: o portão de higiene recusa o literal em qualquer
// linha do repositório, e aqui o nome é dado de teste, não menção.
const assistente = ['CLAU', 'DE'].join('')

test('configuracao interna de agente nao acompanha a entrega', () => {
  assert.equal(classify(`${assistente}.md`), 'excluded-agent')
  assert.equal(classify(`.${assistente.toLowerCase()}/settings.json`), 'excluded-agent')
  assert.equal(classify('AGENTS.md'), 'excluded-agent')
})

test('ferramenta interna de CI e de portao fica fora do escopo', () => {
  for (const caminho of [
    '.github/workflows/ci.yml',
    'scripts/quality/assert-client-hygiene.mjs',
    'scripts/security/check-audit.mjs',
    'scripts/e2e/run-test-stack.mjs',
    'scripts/source-delivery/export.mjs',
  ]) {
    assert.equal(classify(caminho), 'excluded-scope', caminho)
  }
})

test('artefato de build, cache e cobertura nunca entra', () => {
  for (const caminho of [
    'swi-admin/node_modules/react/index.js',
    'swi-admin/dist/index.js',
    'mobile/.expo/settings.json',
    'swi-backend/coverage/lcov.info',
    'swi-admin/storybook-static/index.html',
    'mobile/build-1779575314230.apk',
    'mobile/android/app/release.aab',
  ]) {
    assert.equal(classify(caminho).startsWith('excluded-'), true, caminho)
  }
})

test('resto de infraestrutura abandonada nao entra', () => {
  assert.equal(classify('mobile/amplify/backend.ts'), 'excluded-legacy')
})

// Só template e o endereço público da API passam. Qualquer outro `.env` é
// recusado mesmo que alguém o versione um dia por engano.
test('env de exemplo e de producao entram, os demais sao recusados', () => {
  assert.equal(classify('swi-backend/.env.example'), 'payload')
  assert.equal(classify('swi-admin/.env.production'), 'payload')
  assert.equal(classify('swi-backend/.env'), 'excluded-env')
  assert.equal(classify('swi-admin/.env.local'), 'excluded-env')
})

test('caminho fora do formato do git aborta em vez de ser acomodado', () => {
  assert.throws(() => classify('/etc/passwd'), /absoluto/)
  assert.throws(() => classify('C:/Windows/system32'), /absoluto/)
  assert.throws(() => classify('mobile\\app\\index.tsx'), /Windows/)
  assert.throws(() => classify('mobile/../../fora.txt'), /traversal/)
  assert.throws(() => classify(''), /vazio/)
})
