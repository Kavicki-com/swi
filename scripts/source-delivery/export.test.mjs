import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { decideEntry, exportSnapshot } from './export.mjs'

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function escreve(repo, caminho, conteudo) {
  const destino = join(repo, ...caminho.split('/'))
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, conteudo)
}

/**
 * Repositório temporário com um exemplar de cada situação que a política
 * distingue: texto LF, texto CRLF, SVG, binário, .env de valor, .env.example,
 * documentação e vendor. autocrlf desligado para o blob CRLF continuar CRLF
 * e provar a normalização do exportador, não a do Git.
 */
function criaFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'swi-export-'))
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'fixture@example.test')
  git(repo, 'config', 'user.name', 'Fixture')
  git(repo, 'config', 'core.autocrlf', 'false')

  escreve(repo, 'mobile/app/index.tsx', 'const a = 1\n')
  escreve(repo, 'mobile/app/crlf.ts', 'linha1\r\nlinha2\r\n')
  escreve(repo, 'mobile/NOTICE.txt', 'aviso\n')
  escreve(repo, 'mobile/assets/icon.svg', '<svg></svg>\n')
  escreve(repo, 'mobile/assets/icon.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
  escreve(repo, 'swi-admin/.env.production', 'VITE_API_URL=https://painel.exemplo.com\n')
  escreve(repo, 'swi-admin/vendor/ds.tgz', Buffer.from([0x1f, 0x8b, 0x00, 0x00]))
  escreve(repo, 'swi-backend/.env.example', 'NODE_ENV=development\n')
  escreve(repo, 'docs/plans/a.md', '# plano\n')

  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'fixture')
  return repo
}

/** Lista recursiva de caminhos POSIX relativos, ordenada. */
function anda(raiz, prefixo = '') {
  const caminhos = []
  for (const nome of readdirSync(raiz).sort()) {
    const abs = join(raiz, nome)
    const rel = prefixo ? `${prefixo}/${nome}` : nome
    if (statSync(abs).isDirectory()) caminhos.push(...anda(abs, rel))
    else caminhos.push(rel)
  }
  return caminhos
}

test('exporta o payload normalizado com a árvore preservada', () => {
  const repo = criaFixture()
  const out = join(mkdtempSync(join(tmpdir(), 'swi-out-')), 'entrega')
  exportSnapshot({ repo, out })

  const le = (rel) => readFileSync(join(out, ...rel.split('/')), 'utf8')
  assert.equal(le('data/mobile/app/index.tsx.txt'), 'const a = 1\n')
  assert.equal(le('data/mobile/app/crlf.ts.txt'), 'linha1\nlinha2\n')
  assert.equal(le('data/mobile/NOTICE.txt.txt'), 'aviso\n')
  assert.equal(le('data/swi-backend/.env.example.txt'), 'NODE_ENV=development\n')
})

test('a saída contém somente data/ com arquivos .txt', () => {
  const repo = criaFixture()
  const out = join(mkdtempSync(join(tmpdir(), 'swi-out-')), 'entrega')
  exportSnapshot({ repo, out })

  assert.deepEqual(readdirSync(out), ['data'])
  const arquivos = anda(out)
  assert.ok(arquivos.length > 0)
  for (const arquivo of arquivos) {
    assert.match(arquivo, /\.txt$/)
  }
  const nomes = arquivos.join('\n')
  assert.doesNotMatch(nomes, /icon\.png/)
  assert.doesNotMatch(nomes, /ds\.tgz/)
  assert.doesNotMatch(nomes, /\.env\.production/)
  assert.doesNotMatch(nomes, /docs\//)
})

test('recusa árvore de trabalho suja', () => {
  const repo = criaFixture()
  escreve(repo, 'mobile/sujeira.ts', 'const b = 2\n')
  const out = join(mkdtempSync(join(tmpdir(), 'swi-out-')), 'entrega')
  assert.throws(() => exportSnapshot({ repo, out }), /limpa/)
  assert.equal(existsSync(out), false)
})

test('recusa destino que já existe', () => {
  const repo = criaFixture()
  const out = join(mkdtempSync(join(tmpdir(), 'swi-out-')), 'entrega')
  mkdirSync(out)
  assert.throws(() => exportSnapshot({ repo, out }), /existe/)
})

test('duas execuções produzem árvores idênticas byte a byte', () => {
  const repo = criaFixture()
  const base = mkdtempSync(join(tmpdir(), 'swi-out-'))
  const um = join(base, 'entrega-1')
  const dois = join(base, 'entrega-2')
  exportSnapshot({ repo, out: um })
  exportSnapshot({ repo, out: dois })

  const listaUm = anda(um)
  assert.deepEqual(listaUm, anda(dois))
  for (const rel of listaUm) {
    const a = readFileSync(join(um, ...rel.split('/')))
    const b = readFileSync(join(dois, ...rel.split('/')))
    assert.ok(a.equals(b), `conteúdo divergente em ${rel}`)
  }
})

test('texto inválido aborta sem deixar saída parcial', () => {
  const repo = criaFixture()
  escreve(repo, 'mobile/app/ruim.ts', Buffer.from([0xff, 0xfe, 0x61]))
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'blob invalido')
  const pai = mkdtempSync(join(tmpdir(), 'swi-out-'))
  const out = join(pai, 'entrega')
  assert.throws(() => exportSnapshot({ repo, out }), /mobile\/app\/ruim\.ts/)
  assert.equal(existsSync(out), false)
  assert.deepEqual(readdirSync(pai), [], 'não pode sobrar diretório temporário')
})

test('recusa symlink, submódulo e modo Git desconhecido', () => {
  assert.equal(decideEntry({ mode: '100644', path: 'a.ts' }), 'arquivo')
  assert.equal(decideEntry({ mode: '100755', path: 'b.sh' }), 'arquivo')
  assert.throws(() => decideEntry({ mode: '120000', path: 'link.ts' }), /simbólico/)
  assert.throws(() => decideEntry({ mode: '160000', path: 'sub' }), /submódulo/)
  assert.throws(() => decideEntry({ mode: '040000', path: 'dir' }), /modo/)
})
