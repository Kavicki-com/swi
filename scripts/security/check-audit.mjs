/**
 * Portão de vulnerabilidades da entrega.
 *
 * Roda `npm audit --omit=dev` nos três projetos e responde uma pergunta só:
 * esta árvore pode ser entregue? Bloqueia `critical` e `high`; `moderate` e
 * `low` entram no relatório sem parar nada, porque um portão que nasce vermelho
 * sem ação possível vira ruído e as pessoas passam a ignorá-lo.
 *
 * O que ele NÃO é: um substituto para ler o advisory. A exceção existe
 * justamente para o caso em que a leitura mostrou que o achado não alcança o
 * produto, e ela precisa custar alguma coisa, senão vira o caminho padrão. Por
 * isso expira, exige responsável, e o vencimento bloqueia em vez de avisar.
 *
 * Uso:
 *   node scripts/security/check-audit.mjs
 *   node scripts/security/check-audit.mjs --json
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')

export const PROJETOS = ['mobile', 'swi-admin', 'swi-backend']
export const SEVERIDADES_QUE_BLOQUEIAM = ['critical', 'high']

/**
 * Teto do prazo de exceção. Sem teto, "expira em 2099" seria exceção
 * permanente com aparência de temporária.
 */
export const MAX_DIAS_DE_EXCECAO = 90

/** Curto demais para ser justificativa. Existe para barrar "ok" e "n/a". */
const MIN_JUSTIFICATIVA = 40

const CAMPOS_OBRIGATORIOS = [
  'justificativa',
  'responsavel',
  'declaradaEm',
  'expiraEm',
  'advisories',
]

const DIA_MS = 24 * 60 * 60 * 1000

function diasEntre(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / DIA_MS)
}

/**
 * Por que uma exceção NÃO vale, ou null se ela está de pé.
 *
 * Campo faltando é erro de quem escreveu, não licença para passar: exceção sem
 * responsável não tem a quem cobrar quando vencer.
 */
function problemaDaExcecao(excecao, hoje) {
  for (const campo of CAMPOS_OBRIGATORIOS) {
    const valor = excecao[campo]
    const vazio = valor === undefined || valor === null || valor === '' ||
      (Array.isArray(valor) && valor.length === 0)
    if (vazio) return `exceção sem ${campo}`
  }
  if (String(excecao.justificativa).trim().length < MIN_JUSTIFICATIVA) {
    return `justificativa curta demais (mínimo ${MIN_JUSTIFICATIVA} caracteres)`
  }
  const prazo = diasEntre(excecao.declaradaEm, excecao.expiraEm)
  if (prazo > MAX_DIAS_DE_EXCECAO) {
    return `prazo de ${prazo} dias passa do teto de ${MAX_DIAS_DE_EXCECAO} dias`
  }
  if (new Date(excecao.expiraEm).getTime() < hoje.getTime()) {
    return `exceção vencida em ${excecao.expiraEm}`
  }
  return null
}

/**
 * Confronta os achados com as exceções. Puro de propósito: é o que os testes
 * exercitam, sem npm nem rede.
 */
export function avaliar({ achados, excecoes, hoje }) {
  const bloqueios = []
  const cobertos = []
  const informativos = []
  const usadas = new Set()

  for (const a of achados) {
    if (!SEVERIDADES_QUE_BLOQUEIAM.includes(a.severidade)) {
      informativos.push(a)
      continue
    }
    const i = excecoes.findIndex((e) => e.projeto === a.projeto && e.pacote === a.pacote)
    if (i === -1) {
      bloqueios.push({ ...a, motivo: 'sem exceção declarada' })
      continue
    }
    usadas.add(i)
    const problema = problemaDaExcecao(excecoes[i], hoje)
    if (problema) bloqueios.push({ ...a, motivo: problema })
    else cobertos.push({ ...a, expiraEm: excecoes[i].expiraEm })
  }

  // Exceção que não cobre achado nenhum é lixo acumulando: o pacote foi
  // corrigido ou removido e ninguém limpou. Não bloqueia, mas precisa
  // aparecer, senão a lista só cresce.
  const obsoletas = excecoes.filter((_, i) => !usadas.has(i))

  return { bloqueios, cobertos, informativos, obsoletas }
}

export function lerPolitica(caminho = join(AQUI, 'audit-policy.json')) {
  return JSON.parse(readFileSync(caminho, 'utf8'))
}

/** Roda o audit de um projeto e devolve os achados normalizados. */
export function auditarProjeto(projeto) {
  return new Promise((resolve, reject) => {
    const filho = spawn('npm', ['audit', '--omit=dev', '--json'], {
      cwd: join(RAIZ, projeto),
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let saida = ''
    filho.stdout.on('data', (d) => { saida += d })
    filho.on('error', reject)
    // Código de saída do npm audit é 1 quando há vulnerabilidade, o que é
    // esperado: quem decide se isso bloqueia é este portão, não o npm.
    filho.on('close', () => {
      try {
        const json = JSON.parse(saida)
        resolve(
          Object.values(json.vulnerabilities ?? {}).map((v) => ({
            projeto,
            pacote: v.name,
            severidade: v.severity,
          })),
        )
      } catch (e) {
        reject(new Error(`npm audit em ${projeto} não devolveu JSON: ${e.message}`))
      }
    })
  })
}

function formatar(resultado) {
  const linhas = []
  for (const c of resultado.cobertos) {
    linhas.push(`  tolerado  ${c.projeto}/${c.pacote} [${c.severidade}] até ${c.expiraEm}`)
  }
  for (const o of resultado.obsoletas) {
    linhas.push(`  obsoleta  ${o.projeto}/${o.pacote}: exceção sem achado correspondente, pode sair da política`)
  }
  for (const b of resultado.bloqueios) {
    linhas.push(`  BLOQUEIA  ${b.projeto}/${b.pacote} [${b.severidade}]: ${b.motivo}`)
  }
  return linhas.join('\n')
}

export async function main(argv = []) {
  const politica = lerPolitica()
  const listas = await Promise.all(PROJETOS.map(auditarProjeto))
  const achados = listas.flat()
  const resultado = avaliar({ achados, excecoes: politica.excecoes, hoje: new Date() })

  if (argv.includes('--json')) {
    console.log(JSON.stringify(resultado, null, 2))
  } else {
    console.log(formatar(resultado))
    console.log(
      `\n${resultado.bloqueios.length} bloqueio(s), ${resultado.cobertos.length} tolerado(s), ` +
        `${resultado.informativos.length} informativo(s) de severidade menor.`,
    )
  }
  return resultado.bloqueios.length === 0 ? 0 : 1
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main(process.argv.slice(2)).then(
    (codigo) => process.exit(codigo),
    (erro) => {
      console.error(erro.message)
      process.exit(2)
    },
  )
}
