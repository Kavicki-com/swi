/**
 * Exportador da entrega de código-fonte: lê o commit aprovado (HEAD) de um
 * repositório com árvore de trabalho limpa e materializa somente a pasta
 * data/ com cada arquivo de payload convertido em .txt, na forma da política
 * de policy.mjs.
 *
 * Por decisão do responsável (2026-08-10), o pacote não carrega arquivo de
 * controle nenhum: o contrato pede o código-fonte, e a prova de integridade
 * fica fora da entrega (tag no commit aprovado + hash do pacote gerado).
 * Como a exportação é determinística, qualquer manifesto pode ser
 * recomputado a partir do mesmo commit quando for preciso.
 *
 * A leitura é sempre do snapshot commitado, nunca da árvore de trabalho:
 * arquivo sujo ou untracked não existe para este script, e a exportação nem
 * começa com o status sujo. A escrita acontece num diretório temporário
 * irmão, renomeado para o destino apenas com tudo validado e escrito.
 *
 * Uso:
 *   node scripts/source-delivery/export.mjs --out <dir> [--repo <dir>]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertNoCollisions, classify, deliveryPath, normalizeText } from './policy.mjs'

/** Modos Git de arquivo comum. Todo o resto exige política antes de entrar. */
const MODOS_ARQUIVO = new Set(['100644', '100755'])

/** Valida o modo Git de uma entrada do ls-tree. */
export function decideEntry({ mode, path }) {
  if (mode === '120000') {
    throw new Error(`link simbólico sem política de entrega definida: ${path}`)
  }
  if (mode === '160000') {
    throw new Error(`submódulo sem política de entrega definida: ${path}`)
  }
  if (!MODOS_ARQUIVO.has(mode)) {
    throw new Error(`modo Git desconhecido (${mode}) recusado: ${path}`)
  }
  return 'arquivo'
}

/** Executa git com argumentos posicionais, sem shell e sem interpolação. */
function git(repo, args, opts = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  })
}

function exigeArvoreLimpa(repo) {
  const status = git(repo, ['status', '--porcelain'], { encoding: 'utf8' })
  if (status.trim() !== '') {
    throw new Error(
      'a árvore de trabalho não está limpa; a exportação lê somente o commit aprovado',
    )
  }
}

/** Entradas de blob do commit HEAD: { mode, tipo, oid, path }. */
function listaEntradas(repo) {
  const bruto = git(repo, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], {
    encoding: 'utf8',
  })
  const entradas = []
  for (const linha of bruto.split('\0')) {
    if (linha === '') continue
    const tab = linha.indexOf('\t')
    const [mode, tipo, oid] = linha.slice(0, tab).split(' ')
    entradas.push({ mode, tipo, oid, path: linha.slice(tab + 1) })
  }
  return entradas
}

/**
 * Exporta o snapshot do HEAD de `repo` para o diretório `out` (que não pode
 * existir). Devolve o commit exportado e a contagem de arquivos.
 */
export function exportSnapshot({ repo, out }) {
  const repoAbs = resolve(repo)
  const outAbs = resolve(out)
  if (existsSync(outAbs)) {
    throw new Error(`o destino já existe e não será sobrescrito: ${outAbs}`)
  }
  exigeArvoreLimpa(repoAbs)
  const commit = git(repoAbs, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

  const payload = []
  for (const entrada of listaEntradas(repoAbs)) {
    decideEntry(entrada)
    if (classify(entrada.path) === 'payload-text') payload.push(entrada)
  }
  // Ordem lexicográfica POSIX: a saída independe da ordem do ls-tree.
  payload.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  assertNoCollisions(payload.map((entrada) => deliveryPath(entrada.path)))

  const temporario = `${outAbs}.tmp-export`
  rmSync(temporario, { recursive: true, force: true })
  try {
    for (const entrada of payload) {
      const blob = git(repoAbs, ['cat-file', 'blob', entrada.oid])
      let texto
      try {
        texto = normalizeText(blob)
      } catch (erro) {
        throw new Error(`${entrada.path}: ${erro.message}`)
      }
      const destino = join(temporario, ...deliveryPath(entrada.path).split('/'))
      mkdirSync(dirname(destino), { recursive: true })
      writeFileSync(destino, texto, 'utf8')
    }
    renameSync(temporario, outAbs)
  } catch (erro) {
    rmSync(temporario, { recursive: true, force: true })
    throw erro
  }
  return { commit, arquivos: payload.length }
}

/**
 * Execução direta detectada por URL normalizada em caixa baixa: no Windows o
 * mesmo caminho chega com caixa de drive diferente conforme o invocador.
 */
function ehExecucaoDireta() {
  if (!process.argv[1]) return false
  const invocado = pathToFileURL(resolve(process.argv[1])).href.toLowerCase()
  return invocado === import.meta.url.toLowerCase()
}

if (ehExecucaoDireta()) {
  const args = process.argv.slice(2)
  const valorDe = (nome) => {
    const indice = args.indexOf(nome)
    return indice >= 0 ? args[indice + 1] : undefined
  }
  const raizDoRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const repo = valorDe('--repo') ?? raizDoRepo
  const out = valorDe('--out')
  if (!out) {
    console.error('uso: node scripts/source-delivery/export.mjs --out <dir> [--repo <dir>]')
    process.exit(2)
  }
  const resultado = exportSnapshot({ repo, out })
  console.log(`commit ${resultado.commit}: ${resultado.arquivos} arquivos exportados para ${out}`)
}
