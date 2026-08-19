/**
 * Exportador do pacote entregue ao cliente.
 *
 * Gera o ZIP com `git archive` a partir de um COMMIT, nunca da árvore de
 * trabalho: arquivo sujo, ignorado ou não versionado não existe para este
 * script. É essa propriedade que garante que nenhum `.env` real, nenhum build
 * local e nenhum arquivo de máquina entra no pacote, mesmo que estejam no disco
 * na hora de gerar.
 *
 * A árvore precisa estar limpa. Não é preciosismo: com árvore suja, o que foi
 * revisado e o que foi entregue deixam de ser a mesma coisa, e o commit no
 * manifesto passa a mentir.
 *
 * O que entra é decidido por policy.mjs, e o ZIP produzido é conferido contra
 * essa decisão antes de o manifesto ser escrito.
 *
 * Uso:
 *   node scripts/client-delivery/export.mjs --out <dir> [--commit <ref>] [--version <v>]
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertNoCollisions, classify } from './policy.mjs'

const VERSAO_PADRAO = '1.0.1'

function git(repo, args, opcoes = {}) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opcoes,
  })
}

/** Árvore suja quebra a igualdade entre o que foi revisado e o que sai. */
export function assertArvoreLimpa(repo) {
  const sujo = git(repo, ['status', '--porcelain']).trim()
  if (sujo) {
    throw new Error(
      `árvore de trabalho suja, a exportação seria de um estado que não existe em commit nenhum:\n${sujo}`,
    )
  }
}

/** Caminho, oid e tamanho de cada arquivo do commit. */
export function listaArquivos(repo, commit) {
  const saida = git(repo, ['ls-tree', '-r', '--long', commit])
  const arquivos = []
  for (const linha of saida.split('\n')) {
    if (!linha.trim()) continue
    const [meta, caminho] = linha.split('\t')
    const partes = meta.trim().split(/\s+/)
    arquivos.push({ oid: partes[2], tamanho: Number(partes[3]), caminho })
  }
  return arquivos
}

/**
 * SHA-256 do conteúdo de cada blob, lido do próprio objeto do git.
 *
 * Um `git cat-file` por arquivo custaria centenas de processos; o modo batch
 * resolve tudo num só, alimentado pelos oids e lido em fluxo.
 */
export function hashDosBlobs(repo, oids) {
  if (oids.length === 0) return Promise.resolve(new Map())
  return new Promise((resolvePromise, rejeita) => {
    const processo = spawn('git', ['cat-file', '--batch'], { cwd: repo })
    const hashes = new Map()
    let erroDoGit = ''
    processo.stderr.on('data', (chunk) => {
      erroDoGit += chunk.toString('utf8')
    })
    let pendente = Buffer.alloc(0)
    let indice = 0
    let esperandoCabecalho = true
    let restante = 0
    let oidAtual = ''
    let corpo = []

    processo.stdout.on('data', (chunk) => {
      pendente = Buffer.concat([pendente, chunk])
      for (;;) {
        if (esperandoCabecalho) {
          const quebra = pendente.indexOf(0x0a)
          if (quebra === -1) return
          const cabecalho = pendente.subarray(0, quebra).toString('utf8')
          pendente = pendente.subarray(quebra + 1)
          const partes = cabecalho.split(' ')
          if (partes[1] === 'missing') {
            rejeita(new Error(`objeto ausente no repositório: ${partes[0]}`))
            return
          }
          oidAtual = partes[0]
          restante = Number(partes[2])
          corpo = []
          esperandoCabecalho = false
        }
        // O conteúdo vem seguido de uma quebra de linha que não faz parte dele.
        if (pendente.length < restante + 1) return
        corpo.push(pendente.subarray(0, restante))
        pendente = pendente.subarray(restante + 1)
        hashes.set(oidAtual, createHash('sha256').update(Buffer.concat(corpo)).digest('hex'))
        esperandoCabecalho = true
        indice += 1
        if (indice === oids.length) {
          // Só fecha a entrada. A promessa é resolvida no 'close', quando o
          // processo realmente saiu: no Windows ele mantém o diretório de
          // trabalho preso enquanto vive, e quem chamou pode querer removê-lo.
          processo.stdin.end()
          return
        }
      }
    })
    processo.on('error', rejeita)
    processo.on('close', (codigo) => {
      if (indice === oids.length) {
        resolvePromise(hashes)
      } else {
        rejeita(
          new Error(
            `git cat-file terminou com ${codigo} depois de ${indice}/${oids.length} objetos: ${erroDoGit.trim() || 'sem mensagem'}`,
          ),
        )
      }
    })
    processo.stdin.write(`${oids.join('\n')}\n`)
  })
}

/** Entradas de arquivo do ZIP, sem os diretórios e sem o prefixo de extração. */
export function caminhosDoPacote(zip, prefixo, listarEntradas) {
  return listarEntradas(zip)
    .filter((entrada) => !entrada.endsWith('/'))
    .map((entrada) => {
      if (!entrada.startsWith(prefixo)) {
        throw new Error(`entrada fora do prefixo de extração: ${entrada}`)
      }
      return entrada.slice(prefixo.length)
    })
}

/** Diferença nos dois sentidos, para a mensagem de erro nomear o que sobra e o que falta. */
export function comparaConjuntos(esperado, obtido) {
  const esperadoSet = new Set(esperado)
  const obtidoSet = new Set(obtido)
  return {
    faltando: esperado.filter((c) => !obtidoSet.has(c)),
    sobrando: obtido.filter((c) => !esperadoSet.has(c)),
  }
}

/**
 * O npm entra no manifesto para registrar com que par de runtime o pacote foi
 * gerado. Ausência dele não invalida a exportação, então fica nulo em vez de
 * derrubar tudo.
 */
function versaoNpm() {
  try {
    return execFileSync('npm', ['--version'], { encoding: 'utf8', shell: true }).trim()
  } catch {
    return null
  }
}

function parseArgs(argv) {
  const opcoes = { commit: 'HEAD', versao: VERSAO_PADRAO, out: '', repo: process.cwd() }
  for (let i = 0; i < argv.length; i += 2) {
    const chave = argv[i]
    const valor = argv[i + 1]
    if (!valor) throw new Error(`falta o valor de ${chave}`)
    if (chave === '--out') opcoes.out = valor
    else if (chave === '--commit') opcoes.commit = valor
    else if (chave === '--version') opcoes.versao = valor
    else if (chave === '--repo') opcoes.repo = valor
    else throw new Error(`argumento desconhecido: ${chave}`)
  }
  if (!opcoes.out) throw new Error('informe --out <dir>, o diretório onde o pacote será escrito')
  return opcoes
}

export async function exporta({ repo, out, commit, versao, listarEntradas }) {
  assertArvoreLimpa(repo)
  const sha = git(repo, ['rev-parse', commit]).trim()

  const arquivos = listaArquivos(repo, sha)
  const payload = []
  const excluidos = new Map()
  for (const arquivo of arquivos) {
    const categoria = classify(arquivo.caminho)
    if (categoria === 'payload') payload.push(arquivo)
    else excluidos.set(categoria, (excluidos.get(categoria) ?? 0) + 1)
  }
  if (payload.length === 0) throw new Error('nenhum arquivo sobreviveu à política: recuse o pacote vazio')
  assertNoCollisions(payload.map((a) => a.caminho))

  const nomeZip = `SWI-source-${versao}.zip`
  // A pasta dentro do ZIP é curta e NÃO repete o nome do arquivo, de propósito.
  // Com o prefixo igual ao nome do pacote, extrair para uma pasta homônima
  // produzia `SWI-source-1.0.1\SWI-source-1.0.1\START-SWI.cmd`: o caminho
  // repetido esconde onde está o script que o cliente precisa executar, e ainda
  // gasta o limite de 260 caracteres do Windows antes de chegar no fonte, que já
  // é fundo por natureza (`swi-admin/src/pages/...`). A versão continua no nome
  // do ZIP e no manifesto, que é onde ela serve para alguma coisa.
  const prefixo = 'SWI/'
  mkdirSync(out, { recursive: true })
  const caminhoZip = join(out, nomeZip)

  // Exclusões, e não inclusões: a lista de fora é uma ordem de grandeza menor
  // que a de dentro, e cabe com folga na linha de comando.
  const foraDoPacote = arquivos
    .filter((a) => classify(a.caminho) !== 'payload')
    .map((a) => `:(exclude)${a.caminho}`)
  git(repo, [
    'archive', '--format=zip', `--prefix=${prefixo}`, '-o', resolve(caminhoZip), sha, '--', ...foraDoPacote,
  ])

  // O pacote é conferido contra a política, lendo o artefato. Comparar o ZIP
  // com a lista que este próprio script montou não provaria nada.
  const conferidos = caminhosDoPacote(readFileSync(caminhoZip), prefixo, listarEntradas)
  const { faltando, sobrando } = comparaConjuntos(payload.map((a) => a.caminho), conferidos)
  if (faltando.length || sobrando.length) {
    throw new Error(
      `o ZIP não corresponde à política. faltando ${faltando.length}: ${faltando.slice(0, 5).join(', ')} | sobrando ${sobrando.length}: ${sobrando.slice(0, 5).join(', ')}`,
    )
  }

  const hashes = await hashDosBlobs(repo, payload.map((a) => a.oid))
  const zipBytes = readFileSync(caminhoZip)

  const manifesto = {
    pacote: nomeZip,
    versao,
    commit: sha,
    geradoEm: new Date().toISOString(),
    runtime: { node: process.version, npm: versaoNpm() },
    totais: {
      arquivos: payload.length,
      bytes: payload.reduce((soma, a) => soma + a.tamanho, 0),
      excluidos: Object.fromEntries([...excluidos].sort()),
    },
    arquivos: payload
      .map((a) => ({ caminho: a.caminho, bytes: a.tamanho, sha256: hashes.get(a.oid) }))
      .sort((a, b) => a.caminho.localeCompare(b.caminho)),
  }
  writeFileSync(join(out, 'DELIVERY-MANIFEST.json'), `${JSON.stringify(manifesto, null, 2)}\n`, 'utf8')

  const somaZip = createHash('sha256').update(zipBytes).digest('hex')
  writeFileSync(join(out, 'SHA256SUMS.txt'), `${somaZip}  ${nomeZip}\n`, 'utf8')

  return { caminhoZip, manifesto, somaZip, excluidos }
}

const ehExecucaoDireta = (caminhoInvocado, urlDoModulo) =>
  Boolean(caminhoInvocado) && pathToFileURL(caminhoInvocado).href === urlDoModulo

if (ehExecucaoDireta(process.argv[1], import.meta.url)) {
  const { listarEntradas } = await import('./zip.mjs')
  try {
    const opcoes = parseArgs(process.argv.slice(2))
    const resultado = await exporta({ ...opcoes, listarEntradas })
    console.log(`pacote:   ${resultado.caminhoZip}`)
    console.log(`commit:   ${resultado.manifesto.commit}`)
    console.log(`arquivos: ${resultado.manifesto.totais.arquivos}`)
    console.log(`sha256:   ${resultado.somaZip}`)
    console.log(`excluidos: ${JSON.stringify(resultado.manifesto.totais.excluidos)}`)
  } catch (erro) {
    console.error(erro.message)
    process.exitCode = 1
  }
}
