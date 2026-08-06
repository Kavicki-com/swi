/**
 * Gate de tamanho de arquivo da higienização de entrega.
 *
 * O código vai ser LIDO pelo cliente, e arquivo gigante é o que torna a leitura
 * inviável. A Task 8 decompôs os que passavam de 800 linhas; este gate existe
 * para que o próximo não entre sem alguém perceber.
 *
 * Falha FECHADO de propósito. A conferência original do plano começava com
 * `rg --files ...`, e onde o ripgrep não está no PATH o comando erra, a lista
 * sai vazia e o resultado se lê como aprovação. Aqui uma varredura que não
 * encontra arquivo nenhum é tratada como erro, não como sucesso.
 *
 * Uso:
 *   node scripts/quality/assert-file-size.mjs --dir swi-admin/src
 *   node scripts/quality/assert-file-size.mjs --dir swi-admin/src --max 800 --min-scanned 50
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const EXTENSOES = ['.ts', '.tsx', '.mts', '.cts']
const IGNORAR = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.turbo'])

/**
 * Conta linhas com a mesma semântica do `Get-Content` do PowerShell, que é a da
 * conferência original: a quebra final do arquivo não vale uma linha a mais.
 */
export function countLines(text) {
  if (text === '') return 0
  const lines = String(text).split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.length
}

/** Caminhos de código-fonte sob `dir`, recursivamente, ignorando artefatos. */
export function collectSourceFiles(dir) {
  const encontrados = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(entrada.name)) continue
    const caminho = join(dir, entrada.name)
    if (entrada.isDirectory()) {
      encontrados.push(...collectSourceFiles(caminho))
      continue
    }
    if (EXTENSOES.some((ext) => entrada.name.endsWith(ext))) {
      encontrados.push(caminho)
    }
  }
  return encontrados
}

/** Lê cada caminho e devolve `{ path, lines }`. */
export function measureFiles(caminhos, { cwd = process.cwd() } = {}) {
  return caminhos.map((caminho) => ({
    path: relative(cwd, caminho).replaceAll('\\', '/'),
    lines: countLines(readFileSync(caminho, 'utf8')),
  }))
}

/**
 * Reprova se algum arquivo alcançar `max` linhas, e também se a varredura vier
 * vazia ou menor que `minScanned` — este segundo caso é o que impede o gate de
 * aprovar quando a busca simplesmente não rodou.
 */
export function assertFileSizeGate(files, { max = 800, minScanned = 1 } = {}) {
  if (!Array.isArray(files)) {
    throw new Error('Varredura inválida: esperava uma lista de arquivos medidos.')
  }
  if (files.length < minScanned) {
    throw new Error(
      `Varredura suspeita: ${files.length} arquivo(s) encontrado(s), mínimo esperado ${minScanned}. ` +
        'Confira o caminho passado em --dir antes de tratar isto como aprovação.',
    )
  }

  const acima = files.filter((f) => f.lines >= max).sort((a, b) => b.lines - a.lines)

  if (acima.length > 0) {
    const lista = acima.map((f) => `${f.path} (${f.lines})`).join(', ')
    throw new Error(`Arquivos com ${max} linhas ou mais: ${lista}`)
  }

  const maior = files.reduce((a, b) => (b.lines > a.lines ? b : a), files[0])
  return { scanned: files.length, max, largest: maior }
}

function parseArgs(argv) {
  const dirs = []
  let max = 800
  let minScanned = 1
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') dirs.push(argv[i + 1])
    if (argv[i] === '--max') max = Number(argv[i + 1])
    if (argv[i] === '--min-scanned') minScanned = Number(argv[i + 1])
  }
  return { dirs, max, minScanned }
}

const invokedPath = process.argv[1]?.replaceAll('\\', '/')
const isDirectRun = Boolean(invokedPath) && import.meta.url === new URL(`file:///${invokedPath}`).href

if (isDirectRun) {
  try {
    const { dirs, max, minScanned } = parseArgs(process.argv.slice(2))
    if (dirs.length === 0) {
      throw new Error('Informe ao menos um diretório com --dir.')
    }
    for (const dir of dirs) {
      if (!statSync(dir).isDirectory()) {
        throw new Error(`Não é um diretório: ${dir}`)
      }
    }
    const medidos = dirs.flatMap((dir) => measureFiles(collectSourceFiles(dir)))
    const resultado = assertFileSizeGate(medidos, { max, minScanned })
    console.log(
      `Tamanho aprovado: ${resultado.scanned} arquivo(s) abaixo de ${resultado.max} linhas.`,
    )
    console.log(`Maior: ${resultado.largest.path} (${resultado.largest.lines}).`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
