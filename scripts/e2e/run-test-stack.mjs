/**
 * Runner da stack de teste automatizado (E2E de navegador).
 *
 * Sobe a infraestrutura descartável do `docker-compose.e2e.yml`, aplica as
 * migrations, roda a suíte do alvo e derruba tudo. O teardown vive num
 * `finally` porque é o ponto que mais dói quando falta: uma stack que sobrevive
 * a uma suíte vermelha deixa porta ocupada e volume sujo, e a execução seguinte
 * ou não sobe, ou pior, passa conversando com dados da anterior.
 *
 * O executor é injetável para o teste unitário poder provar a ordem das etapas
 * e o teardown sem falar com Docker de verdade (ver run-test-stack.test.mjs).
 *
 * Uso:
 *   node scripts/e2e/run-test-stack.mjs --target admin
 *   node scripts/e2e/run-test-stack.mjs --target mobile
 *   node scripts/e2e/run-test-stack.mjs --target backend
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')

/**
 * Project name FIXO e distinto do de desenvolvimento. É ele que isola rede,
 * containers e volumes: com o mesmo nome da stack de trabalho, o `down -v` do
 * teardown apagaria o banco de trabalho.
 */
export const E2E_PROJECT = 'swi-source-delivery-e2e'

/**
 * Portas exclusivas. As padrão (5432, 9000, 5173, 3000, 8081) pertencem à stack
 * de desenvolvimento; reusá-las faria o teste conversar em silêncio com o banco
 * errado quando as duas estivessem de pé.
 */
export const E2E_PORTS = {
  postgres: 55432,
  smtp: 51025,
  smtpUi: 58025,
  minio: 59000,
  minioConsole: 59001,
  api: 3300,
  admin: 4173,
  mobile: 18081,
}

const BACKEND = join(RAIZ, 'swi-backend')

/**
 * Cada alvo diz ONDE e COMO rodar a suíte. Os dois alvos de navegador chamam o
 * Playwright; o backend chama a própria suíte E2E do Nest, que não tem
 * navegador nenhum. O que os três compartilham, e é o motivo deste runner
 * existir, é a infraestrutura descartável e o teardown.
 */
const ALVOS = {
  admin: {
    cwd: join(RAIZ, 'swi-admin'),
    comando: (extras) => ['npx', ['playwright', 'test', ...extras]],
  },
  mobile: {
    cwd: join(RAIZ, 'mobile'),
    comando: (extras) => ['npx', ['playwright', 'test', ...extras]],
  },
  backend: {
    cwd: BACKEND,
    // `--forceExit` não é preguiça: o Nest deixa handle aberto no fim da suíte
    // (pool do Prisma, socket do Socket.IO) e sem isto o processo não encerra,
    // então o teardown nunca chegaria e a stack ficaria de pé.
    comando: (extras) => ['npm', ['run', 'test:e2e', '--', '--forceExit', ...extras]],
  },
}

export const DATABASE_URL = `postgresql://swi:swi@localhost:${E2E_PORTS.postgres}/swi`

/**
 * Argumentos do compose. A base vem primeiro e a sobreposição e2e depois:
 * invertida, a sobreposição não valeria e a stack de teste brigaria por porta
 * com a de desenvolvimento.
 */
export function stackArgs(extra) {
  return [
    'compose',
    '-p',
    E2E_PROJECT,
    '-f',
    'docker-compose.yml',
    '-f',
    'docker-compose.e2e.yml',
    ...extra,
  ]
}

/** Executor real. Herda stdio para o log do CI mostrar a saída de cada etapa. */
export function spawnExec(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    })
    filho.on('error', reject)
    filho.on('close', (code) => {
      if (code === 0) resolve({ code })
      else reject(new Error(`Falhou (${code}): ${command} ${args.join(' ')}`))
    })
  })
}

/**
 * Sonda de prontidão do banco.
 *
 * Pergunta ao PROCESSO, e por TCP de dentro do container. Esperar a porta
 * publicada abrir NÃO serve, e isto foi medido: o Docker atende na porta assim
 * que o container sobe, então a espera voltava na hora e o `prisma migrate
 * deploy` seguinte morria com `P1001: Can't reach database server`. O caminho
 * por socket unix também enganaria, porque o entrypoint da imagem sobe um
 * servidor temporário só no socket enquanto inicializa o cluster; o `-h` força
 * a pergunta pelo TCP, que só abre quando o banco está de fato de pé.
 *
 * É o mesmo comando do healthcheck do serviço `db` no docker-compose.yml.
 */
export function pgIsReady() {
  return new Promise((resolve) => {
    const filho = spawn(
      'docker',
      stackArgs(['exec', '-T', 'db', 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'swi', '-d', 'swi']),
      { cwd: BACKEND, stdio: 'ignore', shell: process.platform === 'win32' },
    )
    filho.on('error', () => resolve(false))
    filho.on('close', (code) => resolve(code === 0))
  })
}

/** Repete a sonda até o banco responder, ou desiste com erro. */
export async function waitForPostgres({ probe = pgIsReady, timeoutMs = 120_000, intervalMs = 1_000 } = {}) {
  const limite = Date.now() + timeoutMs
  for (;;) {
    if (await probe()) return
    if (Date.now() > limite) {
      throw new Error(`Postgres não ficou pronto em ${timeoutMs}ms`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/**
 * Sobe, migra, testa e derruba.
 *
 * A falha propagada é sempre a ORIGINAL: um erro no teardown não pode encobrir
 * o motivo pelo qual a suíte quebrou, senão o diagnóstico vira "docker sumiu"
 * quando o problema era o teste.
 */
export async function runTestStack({
  target,
  exec = spawnExec,
  waitForHealth = () => waitForPostgres(),
  testArgs = [],
} = {}) {
  const alvo = ALVOS[target]
  if (!alvo) {
    throw new Error(`Alvo desconhecido: ${target}. Use ${Object.keys(ALVOS).join(' ou ')}.`)
  }

  // As portas descem do runner para os configs do Playwright. Elas são
  // declaradas aqui e lidas lá; sem esta passagem, mudar `E2E_PORTS` deixaria
  // o config apontando para a porta antiga, e o teste conversaria com a stack
  // errada sem reclamar de nada.
  const env = {
    ...process.env,
    DATABASE_URL,
    E2E_TARGET: target,
    E2E_API_PORT: String(E2E_PORTS.api),
    E2E_ADMIN_PORT: String(E2E_PORTS.admin),
    E2E_MOBILE_PORT: String(E2E_PORTS.mobile),
  }
  let original = null

  try {
    await exec('docker', stackArgs(['up', '-d', 'db', 'mailhog', 'minio', 'minio-init']), { cwd: BACKEND })
    await waitForHealth()
    await exec('npx', ['prisma', 'migrate', 'deploy'], { cwd: BACKEND, env })
    // Roda com cwd em swi-backend: é lá que vivem o @prisma/client gerado e o
    // bcrypt que o seed usa.
    await exec('node', [join(AQUI, 'seed-e2e.mjs')], { cwd: BACKEND, env })
    const [comando, args] = alvo.comando(testArgs)
    await exec(comando, args, { cwd: alvo.cwd, env })
  } catch (erro) {
    original = erro
  } finally {
    try {
      await exec('docker', stackArgs(['down', '-v', '--remove-orphans']), { cwd: BACKEND })
    } catch (erroDoTeardown) {
      // Só vira a falha reportada se nada tiver falhado antes.
      if (!original) original = erroDoTeardown
    }
  }

  if (original) throw original
}

function parseArgs(argv) {
  const i = argv.indexOf('--target')
  const rest = i === -1 ? argv : argv.filter((_, k) => k !== i && k !== i + 1)
  return { target: i === -1 ? undefined : argv[i + 1], rest }
}

const invokedPath = process.argv[1]?.replaceAll('\\', '/')
const isDirectRun = Boolean(invokedPath) && import.meta.url === new URL(`file:///${invokedPath}`).href

if (isDirectRun) {
  const { target, rest } = parseArgs(process.argv.slice(2))
  runTestStack({ target, testArgs: rest }).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
