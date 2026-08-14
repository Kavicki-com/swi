import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ehExecucaoDireta } from './seed-e2e.mjs'

// O seed do E2E só escreve no banco quando é executado direto. Se a detecção
// falhar, ele termina com código 0 sem semear nada, e o job de E2E segue até
// quebrar no login com o banco vazio. Uma saída silenciosa como essa é pior que
// um erro, então a conversão de caminho para URL é cercada aqui.
//
// Espelha `ehExecucaoDireta` de run-test-stack.mjs, que resolve o mesmo ponto.

test('reconhece execucao direta a partir do caminho do proprio modulo', () => {
  const url = import.meta.url
  assert.equal(ehExecucaoDireta(fileURLToPath(url), url), true)
})

// Invariante que vale em qualquer sistema: o caminho e a URL que a plataforma
// deriva dele descrevem o mesmo arquivo. Concatenar `'file:///'` com um caminho
// que já começa em barra produz quatro barras e quebra esta igualdade, que é
// como a detecção falha num runner Linux.
test('caminho e a URL que a plataforma deriva dele descrevem o mesmo arquivo', () => {
  const caminho = '/home/runner/work/seed-e2e.mjs'
  assert.equal(ehExecucaoDireta(caminho, pathToFileURL(caminho).href), true)
})

test('nao confunde importacao com execucao direta', () => {
  assert.equal(ehExecucaoDireta('/home/runner/outro.mjs', 'file:///home/runner/work/seed-e2e.mjs'), false)
  assert.equal(ehExecucaoDireta(undefined, 'file:///home/runner/work/seed-e2e.mjs'), false)
})
