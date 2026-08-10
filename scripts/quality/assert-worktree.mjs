/**
 * Guard de execução da higienização de entrega.
 *
 * O trabalho só pode acontecer na worktree isolada: o checkout principal é
 * tratado como somente leitura. Checagem opt-in: rodar no início de cada
 * sessão de higienização para falhar alto quando o comando estiver no
 * checkout errado, em vez de sujar `main`. Não é chamada por outros scripts
 * de propósito: runner de E2E e gates também rodam em CI, onde raiz e branch
 * são as do runner.
 *
 * Uso:
 *   node scripts/quality/assert-worktree.mjs --expected-root <caminho> --expected-branch <branch>
 */

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Uniformiza separadores, barra final e caixa para comparar caminhos do Windows. */
export function normalizeRoot(value) {
  const slashed = String(value).replaceAll('\\', '/').replace(/\/+$/, '')
  return slashed.toLowerCase()
}

export function assertExecutionContext(actual, expected) {
  if (!expected?.root) {
    throw new Error('Contexto esperado incompleto: informe --expected-root.')
  }
  if (!expected?.branch) {
    throw new Error('Contexto esperado incompleto: informe --expected-branch.')
  }

  if (normalizeRoot(actual?.root ?? '') !== normalizeRoot(expected.root)) {
    throw new Error(
      `Execução fora da worktree isolada. Esperado: ${expected.root}. Atual: ${actual?.root ?? '(desconhecido)'}.`,
    )
  }

  if (actual?.branch !== expected.branch) {
    throw new Error(
      `Execução na branch errada. Esperado: ${expected.branch}. Atual: ${actual?.branch ?? '(desconhecida)'}.`,
    )
  }

  return { root: expected.root, branch: expected.branch }
}

export function readGitContext(cwd = process.cwd()) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  return { root: git(['rev-parse', '--show-toplevel']), branch: git(['branch', '--show-current']) }
}

function parseArgs(argv) {
  const read = (flag) => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  return { root: read('--expected-root'), branch: read('--expected-branch') }
}

// Comparação sem caixa: no Windows o import.meta.url usa a caixa canônica do
// disco, e o argv[1] usa a digitada; diferença aqui fazia o guard sair 0 em
// silêncio, que num guard se lê como aprovação.
const isDirectRun =
  Boolean(process.argv[1]) &&
  pathToFileURL(process.argv[1]).href.toLowerCase() === import.meta.url.toLowerCase()

if (isDirectRun) {
  try {
    const context = assertExecutionContext(readGitContext(), parseArgs(process.argv.slice(2)))
    console.log(`Worktree aprovada: ${context.root}`)
    console.log(`Branch aprovada: ${context.branch}`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
