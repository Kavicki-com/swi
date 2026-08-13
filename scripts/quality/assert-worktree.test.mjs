import test from 'node:test'
import assert from 'node:assert/strict'
import { assertExecutionContext, normalizeRoot } from './assert-worktree.mjs'

const expected = { root: 'C:/isolated/source-delivery', branch: 'chore/repo-source-delivery' }

test('aceita somente a branch e a worktree de entrega', () => {
  assert.doesNotThrow(() => assertExecutionContext(expected, expected))
})

test('recusa o checkout principal', () => {
  const actual = { root: 'C:/repo', branch: 'main' }
  assert.throws(() => assertExecutionContext(actual, expected), /worktree isolada/)
})

test('recusa a branch errada dentro da worktree correta', () => {
  const actual = { root: expected.root, branch: 'main' }
  assert.throws(() => assertExecutionContext(actual, expected), /branch/)
})

test('normaliza separadores e barra final antes de comparar', () => {
  const actual = { root: 'C:\\isolated\\source-delivery\\', branch: expected.branch }
  assert.doesNotThrow(() => assertExecutionContext(actual, expected))
})

test('compara a raiz sem diferenciar maiusculas de minusculas', () => {
  const actual = { root: 'c:/ISOLATED/Source-Delivery', branch: expected.branch }
  assert.doesNotThrow(() => assertExecutionContext(actual, expected))
})

test('nao aceita uma raiz que apenas comeca com a esperada', () => {
  const actual = { root: 'C:/isolated/source-delivery-2', branch: expected.branch }
  assert.throws(() => assertExecutionContext(actual, expected), /worktree isolada/)
})

test('exige contexto esperado completo', () => {
  assert.throws(() => assertExecutionContext(expected, { root: expected.root }), /--expected-branch/)
  assert.throws(() => assertExecutionContext(expected, { branch: expected.branch }), /--expected-root/)
})

test('normalizeRoot remove barra final e uniformiza separadores', () => {
  assert.equal(normalizeRoot('C:\\a\\b\\'), 'c:/a/b')
  assert.equal(normalizeRoot('C:/a/b'), 'c:/a/b')
})
