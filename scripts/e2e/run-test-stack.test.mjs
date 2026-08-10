import test from 'node:test'
import assert from 'node:assert/strict'
import { E2E_PORTS, E2E_PROJECT, runTestStack, stackArgs, waitForPostgres } from './run-test-stack.mjs'

// O runner sobe a infraestrutura de teste, roda o Playwright do alvo e derruba
// tudo. O que estes testes cercam não é o caminho feliz: é o teardown, porque
// uma stack que sobrevive a uma falha deixa volume e porta ocupados, e a próxima
// execução conversa com um banco sujo, ou nem sobe.
//
// O executor é injetado: nenhum teste aqui fala com Docker de verdade.

/** Executor falso: grava o que foi chamado e falha onde o teste mandar. */
const fakeExec = ({ failOn } = {}) => {
  const calls = []
  const exec = async (command, args) => {
    const line = [command, ...args].join(' ')
    calls.push(line)
    if (failOn && line.includes(failOn)) throw new Error(`falhou: ${failOn}`)
    return { code: 0 }
  }
  return { calls, exec }
}

const rodar = async (over = {}) => {
  const { calls, exec } = fakeExec(over)
  const erro = await runTestStack({
    target: over.target ?? 'admin',
    exec,
    waitForHealth: over.waitForHealth ?? (async () => {}),
  }).then(
    () => null,
    (e) => e,
  )
  return { calls, erro }
}

const derrubou = (calls) => calls.some((c) => c.includes('down -v --remove-orphans'))

test('sobe a stack, migra, roda o playwright e derruba, nesta ordem', async () => {
  const { calls, erro } = await rodar()
  assert.equal(erro, null)

  const etapas = calls.map((c) =>
    c.includes(' up ') ? 'up'
      : c.includes('migrate deploy') ? 'migrate'
      : c.includes('seed-e2e') ? 'seed'
      : c.includes('playwright test') ? 'test'
      : c.includes('down') ? 'down'
      : 'outro',
  )
  assert.deepEqual(etapas, ['up', 'migrate', 'seed', 'test', 'down'])
})

// O seed depende das tabelas: invertido, ele estoura em relação inexistente.
test('o seed roda depois da migration e antes do playwright', async () => {
  const { calls } = await rodar()
  const iMigrate = calls.findIndex((c) => c.includes('migrate deploy'))
  const iSeed = calls.findIndex((c) => c.includes('seed-e2e'))
  const iTest = calls.findIndex((c) => c.includes('playwright test'))
  assert.ok(iMigrate < iSeed, 'seed antes da migration')
  assert.ok(iSeed < iTest, 'playwright antes do seed')
})

test('derruba a stack quando o seed falha', async () => {
  const { calls, erro } = await rodar({ failOn: 'seed-e2e' })
  assert.match(erro.message, /seed-e2e/)
  assert.ok(derrubou(calls), 'teardown nao rodou apos falha do seed')
})

// O caso que justifica o try/finally. Sem ele, um Playwright vermelho deixa
// Postgres e MinIO de pé com o volume da execução anterior.
test('derruba a stack mesmo quando o playwright falha', async () => {
  const { calls, erro } = await rodar({ failOn: 'playwright test' })
  assert.match(erro.message, /playwright test/)
  assert.ok(derrubou(calls), 'teardown nao rodou apos falha do playwright')
})

test('derruba a stack quando a migration falha', async () => {
  const { calls, erro } = await rodar({ failOn: 'migrate deploy' })
  assert.match(erro.message, /migrate deploy/)
  assert.ok(derrubou(calls), 'teardown nao rodou apos falha da migration')
})

// Health check que nunca fica pronto é falha de infraestrutura, não de teste:
// precisa derrubar igual, senão a stack meio subida fica órfã.
test('derruba a stack quando o health check estoura', async () => {
  const { calls, exec } = fakeExec()
  const erro = await runTestStack({
    target: 'admin',
    exec,
    waitForHealth: async () => {
      throw new Error('banco nao ficou saudavel')
    },
  }).then(() => null, (e) => e)

  assert.match(erro.message, /saudavel/)
  assert.ok(derrubou(calls), 'teardown nao rodou apos health check falhar')
})

// Falhar ao subir ainda exige teardown: o compose pode ter criado rede e
// containers parciais antes de estourar.
test('derruba a stack mesmo quando o up falha', async () => {
  const { calls, erro } = await rodar({ failOn: ' up ' })
  assert.match(erro.message, /up/)
  assert.ok(derrubou(calls), 'teardown nao rodou apos falha do up')
})

// A falha que importa é a do teste, não a do teardown: trocar uma pela outra
// esconderia o motivo real atrás de um erro de Docker.
test('erro do teardown nao encobre a falha original', async () => {
  const calls = []
  const exec = async (command, args) => {
    const line = [command, ...args].join(' ')
    calls.push(line)
    if (line.includes('playwright test')) throw new Error('suite vermelha')
    if (line.includes('down')) throw new Error('docker sumiu')
    return { code: 0 }
  }
  const erro = await runTestStack({ target: 'admin', exec, waitForHealth: async () => {} })
    .then(() => null, (e) => e)

  assert.match(erro.message, /suite vermelha/)
  assert.ok(derrubou(calls))
})

// Project name fixo isola rede, containers e volumes da stack de trabalho. Se
// ele variar, um `down -v` de teste pode apagar o banco de desenvolvimento.
// O backend nao tem navegador: a suite dele e a do proprio Nest. Chamar o
// playwright ali encontraria zero spec e passaria VERDE sem testar nada, que e
// o pior desfecho possivel pra um portao.
test('o alvo backend roda a suite do nest, nao o playwright', async () => {
  const { calls, erro } = await rodar({ target: 'backend' })
  assert.equal(erro, null)
  assert.ok(calls.some((c) => c.includes('run test:e2e')), 'nao chamou a suite do backend')
  assert.ok(!calls.some((c) => c.includes('playwright')), 'chamou playwright no alvo backend')
  // Sem --forceExit o processo do Nest nao encerra (handles abertos) e o
  // teardown nunca chega: a stack ficaria de pe depois de uma suite verde.
  assert.ok(calls.some((c) => c.includes('--forceExit')), 'faltou --forceExit')
})

test('derruba a stack mesmo quando a suite do backend falha', async () => {
  const { calls, erro } = await rodar({ target: 'backend', failOn: 'run test:e2e' })
  assert.match(erro.message, /test:e2e/)
  assert.ok(derrubou(calls), 'teardown nao rodou apos falha da suite do backend')
})

test('usa sempre o mesmo project name, isolado da stack de desenvolvimento', async () => {
  for (const target of ['admin', 'mobile', 'backend']) {
    const { calls } = await rodar({ target })
    const doDocker = calls.filter((c) => c.startsWith('docker'))
    assert.ok(doDocker.length > 0)
    for (const c of doDocker) assert.ok(c.includes(`-p ${E2E_PROJECT}`), c)
  }
  assert.notEqual(E2E_PROJECT, 'swi')
})

test('o teardown remove o volume e os orfaos', async () => {
  const { calls } = await rodar()
  const down = calls.find((c) => c.includes('down'))
  assert.match(down, /down -v --remove-orphans/)
})

test('cada alvo roda o playwright no seu proprio diretorio', async () => {
  const admin = await rodar({ target: 'admin' })
  const mobile = await rodar({ target: 'mobile' })
  assert.notEqual(
    admin.calls.find((c) => c.includes('playwright')),
    undefined,
  )
  assert.notEqual(
    mobile.calls.find((c) => c.includes('playwright')),
    undefined,
  )
})

test('alvo desconhecido falha antes de tocar o docker', async () => {
  const { calls, exec } = fakeExec()
  const erro = await runTestStack({ target: 'desktop', exec, waitForHealth: async () => {} })
    .then(() => null, (e) => e)

  assert.match(erro.message, /desktop/)
  assert.deepEqual(calls, [], 'nao pode subir stack pra alvo invalido')
})

// As portas são exclusivas de propósito: as padrão (5432, 9000, 5173) pertencem
// à stack de desenvolvimento, e reusá-las faria o teste conversar em silêncio
// com o banco de trabalho.
test('as portas de teste nao colidem com as de desenvolvimento', () => {
  const padrao = [5432, 9000, 9001, 1025, 8025, 5173, 3000, 8081]
  for (const [nome, porta] of Object.entries(E2E_PORTS)) {
    assert.ok(!padrao.includes(porta), `${nome} usa a porta de desenvolvimento ${porta}`)
  }
  const usadas = Object.values(E2E_PORTS)
  assert.equal(new Set(usadas).size, usadas.length, 'ha porta repetida entre servicos')
})

// As portas vivem em E2E_PORTS aqui e sao lidas nos playwright.config.ts dos
// alvos. Sem a passagem por env, mudar uma delas deixaria o config na porta
// antiga e o teste conversaria com a stack errada em silencio.
test('as portas da stack descem do runner pro config do alvo', async () => {
  const chamadas = []
  const exec = async (command, args, options = {}) => {
    chamadas.push({ linha: [command, ...args].join(' '), env: options.env })
    return { code: 0 }
  }
  await runTestStack({ target: 'mobile', exec, waitForHealth: async () => {} })

  const doTeste = chamadas.find((c) => c.linha.includes('playwright test'))
  assert.equal(doTeste.env.E2E_MOBILE_PORT, String(E2E_PORTS.mobile))
  assert.equal(doTeste.env.E2E_ADMIN_PORT, String(E2E_PORTS.admin))
  assert.equal(doTeste.env.E2E_API_PORT, String(E2E_PORTS.api))
})

// Este par existe por causa de uma falha real: a espera anterior so verificava
// se a PORTA aceitava conexao, e o Docker aceita assim que o container sobe.
// A espera voltava na hora e o `prisma migrate deploy` seguinte morria com
// P1001. A sonda precisa insistir ate o banco responder, nao ate a porta abrir.
test('espera o postgres responder antes de seguir', async () => {
  let tentativas = 0
  await waitForPostgres({
    probe: async () => ++tentativas >= 3,
    intervalMs: 1,
  })
  assert.equal(tentativas, 3, 'desistiu antes de o banco responder')
})

test('desiste com erro quando o postgres nunca responde', async () => {
  const erro = await waitForPostgres({
    probe: async () => false,
    timeoutMs: 5,
    intervalMs: 1,
  }).then(() => null, (e) => e)

  assert.match(erro.message, /nao ficou pronto|não ficou pronto/)
})

test('stackArgs sempre carrega os dois compose, na ordem que faz a sobreposicao valer', () => {
  const args = stackArgs(['up'])
  const base = args.indexOf('docker-compose.yml')
  const over = args.indexOf('docker-compose.e2e.yml')
  assert.ok(base !== -1 && over !== -1)
  assert.ok(base < over, 'a sobreposicao e2e precisa vir depois da base')
})
