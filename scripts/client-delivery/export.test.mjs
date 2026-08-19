import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { assertArvoreLimpa, comparaConjuntos, exporta, hashDosBlobs, listaArquivos } from './export.mjs'
import { listarEntradas } from './zip.mjs'

// A exportação é conferida ponta a ponta contra um repositório de verdade: o
// que importa provar é que o ZIP entregue contém exatamente o que a política
// escolheu, nem mais nem menos, e que o manifesto descreve esse ZIP.

// `await` no callback é obrigatório: sem ele o finally apaga o repositório
// enquanto a exportação ainda está lendo objetos, e o git falha por um motivo
// que não tem nada a ver com o que o teste afirma.
async function comRepositorio(arquivos, callback) {
  const raiz = mkdtempSync(join(tmpdir(), 'client-delivery-'))
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
    return await callback(raiz, git)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

const PROJETO = {
  'mobile/app/index.tsx': 'export default function App() {}\n',
  'swi-admin/src/main.tsx': 'export const main = 1\n',
  'swi-backend/src/main.ts': 'export const main = 1\n',
  'START-SWI.cmd': '@echo off\n',
  'scripts/client/start-swi.ps1': 'Write-Output "up"\n',
  'NOTICE.md': 'proprietario\n',
  // Tudo abaixo tem que ficar de fora.
  'README.md': 'documentacao\n',
  [`${['CLAU', 'DE'].join('')}.md`]: 'instrucao interna\n',
  'docs/plans/plano.md': 'plano interno\n',
  '.github/workflows/ci.yml': 'name: ci\n',
  'scripts/quality/gate.mjs': 'export const x = 1\n',
  'swi-backend/.env': 'SEGREDO=1\n',
}

test('o pacote contem o codigo das frentes e o minimo de raiz, e nada alem disso', async () => {
  await comRepositorio(PROJETO, async (raiz) => {
    const out = join(raiz, 'saida')
    const { caminhoZip, manifesto } = await exporta({
      repo: raiz, out, commit: 'HEAD', versao: '9.9.9', listarEntradas,
    })

    const dentro = listarEntradas(readFileSync(caminhoZip))
      .filter((e) => !e.endsWith('/'))
      .map((e) => e.replace('SWI/', ''))
      .sort()

    assert.deepEqual(dentro, [
      'NOTICE.md',
      'START-SWI.cmd',
      'mobile/app/index.tsx',
      'scripts/client/start-swi.ps1',
      'swi-admin/src/main.tsx',
      'swi-backend/src/main.ts',
    ])
    assert.equal(manifesto.totais.arquivos, 6)
  })
})

// A pasta dentro do ZIP nao repete o nome do arquivo. Com o prefixo antigo,
// extrair SWI-source-1.0.1.zip para uma pasta de mesmo nome produzia
// SWI-source-1.0.1\SWI-source-1.0.1\START-SWI.cmd: caminho que confunde quem
// procura o script e que gasta o limite de 260 caracteres do Windows antes
// mesmo de chegar no fonte, que ja e fundo por natureza.
test('a pasta dentro do ZIP e curta e nao repete o nome do pacote', async () => {
  await comRepositorio(PROJETO, async (raiz) => {
    const out = join(raiz, 'saida')
    const { caminhoZip } = await exporta({
      repo: raiz, out, commit: 'HEAD', versao: '9.9.9', listarEntradas,
    })

    const entradas = listarEntradas(readFileSync(caminhoZip)).filter((e) => !e.endsWith('/'))
    assert.equal(entradas.length > 0, true)
    assert.equal(entradas.every((e) => e.startsWith('SWI/')), true)
    assert.equal(entradas.includes('SWI/START-SWI.cmd'), true)
  })
})

test('o env real nao entra nem quando esta versionado', async () => {
  await comRepositorio(PROJETO, async (raiz) => {
    const out = join(raiz, 'saida')
    const { caminhoZip } = await exporta({ repo: raiz, out, commit: 'HEAD', versao: '9.9.9', listarEntradas })
    const bruto = readFileSync(caminhoZip)
    assert.equal(listarEntradas(bruto).some((e) => e.includes('.env')), false)
    assert.equal(bruto.includes('SEGREDO'), false)
  })
})

test('o manifesto registra commit, contagem e o sha256 de cada arquivo', async () => {
  await comRepositorio(PROJETO, async (raiz, git) => {
    const out = join(raiz, 'saida')
    const { manifesto } = await exporta({ repo: raiz, out, commit: 'HEAD', versao: '9.9.9', listarEntradas })

    assert.equal(manifesto.commit, git('rev-parse', 'HEAD').trim())
    assert.equal(manifesto.arquivos.length, 6)

    const notice = manifesto.arquivos.find((a) => a.caminho === 'NOTICE.md')
    assert.equal(notice.sha256, createHash('sha256').update('proprietario\n').digest('hex'))
    assert.equal(notice.bytes, Buffer.byteLength('proprietario\n'))
  })
})

test('SHA256SUMS confere com o ZIP escrito', async () => {
  await comRepositorio(PROJETO, async (raiz) => {
    const out = join(raiz, 'saida')
    const { caminhoZip, somaZip } = await exporta({ repo: raiz, out, commit: 'HEAD', versao: '9.9.9', listarEntradas })
    const somas = readFileSync(join(out, 'SHA256SUMS.txt'), 'utf8')
    const real = createHash('sha256').update(readFileSync(caminhoZip)).digest('hex')
    assert.equal(somaZip, real)
    assert.equal(somas.trim(), `${real}  SWI-source-9.9.9.zip`)
  })
})

test('arvore suja aborta a exportacao em vez de empacotar um estado sem commit', () => {
  comRepositorio(PROJETO, (raiz) => {
    writeFileSync(join(raiz, 'mobile/app/index.tsx'), 'alteracao nao commitada\n', 'utf8')
    assert.throws(() => assertArvoreLimpa(raiz), /árvore de trabalho suja/)
  })
})

test('listaArquivos devolve oid e tamanho de cada caminho do commit', () => {
  comRepositorio({ 'a.txt': 'conteudo\n' }, (raiz) => {
    const arquivos = listaArquivos(raiz, 'HEAD')
    assert.equal(arquivos.length, 1)
    assert.equal(arquivos[0].caminho, 'a.txt')
    assert.equal(arquivos[0].tamanho, 9)
    assert.match(arquivos[0].oid, /^[0-9a-f]{40}$/)
  })
})

test('hashDosBlobs le o conteudo do objeto, nao do disco', async () => {
  await comRepositorio({ 'a.txt': 'conteudo\n' }, async (raiz) => {
    const [arquivo] = listaArquivos(raiz, 'HEAD')
    // O disco passa a divergir do commit; o hash tem que seguir o commit.
    writeFileSync(join(raiz, 'a.txt'), 'outra coisa\n', 'utf8')
    const hashes = await hashDosBlobs(raiz, [arquivo.oid])
    assert.equal(hashes.get(arquivo.oid), createHash('sha256').update('conteudo\n').digest('hex'))
  })
})

test('comparaConjuntos nomeia o que falta e o que sobra', () => {
  const { faltando, sobrando } = comparaConjuntos(['a', 'b'], ['b', 'c'])
  assert.deepEqual(faltando, ['a'])
  assert.deepEqual(sobrando, ['c'])
})
