import test from 'node:test'
import assert from 'node:assert/strict'
import { assertFileSizeGate, countLines } from './assert-file-size.mjs'

const ok = [
  { path: 'src/a.ts', lines: 120 },
  { path: 'src/b.tsx', lines: 799 },
]

test('aprova quando todo arquivo fica abaixo do limite', () => {
  const resultado = assertFileSizeGate(ok)
  assert.equal(resultado.scanned, 2)
  assert.equal(resultado.largest.path, 'src/b.tsx')
})

test('reprova no limite exato, porque 800 ja e grande demais', () => {
  const files = [...ok, { path: 'src/c.tsx', lines: 800 }]
  assert.throws(() => assertFileSizeGate(files), /src\/c\.tsx \(800\)/)
})

test('lista todos os reprovados, do maior para o menor', () => {
  const files = [
    { path: 'src/pequeno.ts', lines: 810 },
    { path: 'src/grande.ts', lines: 1200 },
  ]
  assert.throws(
    () => assertFileSizeGate(files),
    /src\/grande\.ts \(1200\), src\/pequeno\.ts \(810\)/,
  )
})

// O motivo de este gate existir como script: a conferencia original do plano
// usava `rg`, e sem o ripgrep no PATH a lista saia vazia e passava por aprovada.
test('reprova varredura vazia em vez de tratar como aprovacao', () => {
  assert.throws(() => assertFileSizeGate([]), /Varredura suspeita/)
})

test('reprova varredura menor que o minimo esperado', () => {
  assert.throws(() => assertFileSizeGate(ok, { minScanned: 50 }), /esperado 50/)
})

test('reprova entrada que nao e lista', () => {
  assert.throws(() => assertFileSizeGate(null), /Varredura inv/)
})

test('respeita um limite customizado', () => {
  assert.throws(() => assertFileSizeGate(ok, { max: 500 }), /500 linhas ou mais/)
  assert.doesNotThrow(() => assertFileSizeGate(ok, { max: 900 }))
})

test('countLines nao conta a quebra final como linha extra', () => {
  assert.equal(countLines('a\nb\n'), 2)
  assert.equal(countLines('a\nb'), 2)
  assert.equal(countLines('a\r\nb\r\n'), 2)
  assert.equal(countLines(''), 0)
  assert.equal(countLines('\n'), 1)
})
