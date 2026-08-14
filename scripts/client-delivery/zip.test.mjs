import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { listarEntradas } from './zip.mjs'

// O leitor é conferido contra um ZIP produzido pelo mesmo `git archive` que
// gera a entrega. Um leitor testado só com bytes montados à mão provaria que
// ele entende a minha ideia de ZIP, não a que o git escreve.

function comRepositorio(arquivos, callback) {
  const raiz = mkdtempSync(join(tmpdir(), 'client-delivery-zip-'))
  try {
    const git = (...args) => execFileSync('git', args, { cwd: raiz, encoding: 'utf8' })
    git('init', '--quiet')
    git('config', 'user.email', 'teste@local')
    git('config', 'user.name', 'Teste')
    for (const [caminho, conteudo] of Object.entries(arquivos)) {
      const destino = join(raiz, caminho)
      mkdirSync(dirname(destino), { recursive: true })
      writeFileSync(destino, conteudo, 'utf8')
    }
    git('add', '-A')
    git('commit', '--quiet', '-m', 'inicial')
    callback(raiz, git)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

test('le os caminhos que o git archive escreveu', () => {
  comRepositorio(
    { 'a.txt': 'um', 'pasta/b.txt': 'dois', 'pasta/sub/c.txt': 'tres' },
    (raiz, git) => {
      const zip = join(raiz, 'saida.zip')
      git('archive', '--format=zip', '-o', zip, 'HEAD')
      const entradas = listarEntradas(readFileSync(zip))
      assert.deepEqual(
        entradas.filter((e) => !e.endsWith('/')).sort(),
        ['a.txt', 'pasta/b.txt', 'pasta/sub/c.txt'],
      )
    },
  )
})

test('enxerga o prefixo de extracao', () => {
  comRepositorio({ 'a.txt': 'um' }, (raiz, git) => {
    const zip = join(raiz, 'saida.zip')
    git('archive', '--format=zip', '--prefix=SWI-source-1.0.1/', '-o', zip, 'HEAD')
    const entradas = listarEntradas(readFileSync(zip))
    assert.equal(entradas.includes('SWI-source-1.0.1/a.txt'), true)
  })
})

test('respeita a exclusao por pathspec, que e como a politica chega no archive', () => {
  comRepositorio({ 'a.txt': 'um', 'docs/interno.md': 'segredo' }, (raiz, git) => {
    const zip = join(raiz, 'saida.zip')
    git('archive', '--format=zip', '-o', zip, 'HEAD', '--', ':(exclude)docs')
    const entradas = listarEntradas(readFileSync(zip)).filter((e) => !e.endsWith('/'))
    assert.deepEqual(entradas, ['a.txt'])
  })
})

test('recusa arquivo que nao e ZIP em vez de devolver lista vazia', () => {
  assert.throws(() => listarEntradas(Buffer.from('isto nao e um zip, nem de longe')), /não é um ZIP/)
  assert.throws(() => listarEntradas(Buffer.alloc(4)), /pequeno demais/)
})
