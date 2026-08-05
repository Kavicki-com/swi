/**
 * Guard de execução da higienização de entrega.
 *
 * O trabalho só pode acontecer na worktree isolada: o checkout principal é
 * tratado como somente leitura. Este guard existe para que qualquer script ou
 * sessão futura falhe alto ao rodar no lugar errado, em vez de sujar `main`.
 *
 * Uso:
 *   node scripts/quality/assert-worktree.mjs --expected-root <caminho> --expected-branch <branch>
 */

import { execFileSync } from 'node:child_process'

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

const invokedPath = process.argv[1]?.replaceAll('\\', '/')
const isDirectRun = Boolean(invokedPath) && import.meta.url === new URL(`file:///${invokedPath}`).href

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
