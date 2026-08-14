import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { exportSnapshot } from './export.mjs'
import { assertNomesSeguros, verifyDelivery } from './verify.mjs'

// O que estes testes cercam é a ADULTERAÇÃO, não o caminho feliz. Um
// verificador que só sabe dizer "está tudo bem" é pior que nenhum, porque
// carrega a autoridade de um portão sem exercer nenhuma: o valor dele está
// inteiro nos casos em que ele precisa REPROVAR.

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function escreve(raiz, caminho, conteudo) {
  const destino = join(raiz, ...caminho.split('/'))
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, conteudo)
}

/**
 * Repositório temporário com um exemplar de cada situação que a política
 * distingue, mais o pacote já exportado dele. `autocrlf` desligado para o blob
 * CRLF continuar CRLF: é ele que prova a normalização.
 */
function criaCenario() {
  const repo = mkdtempSync(join(tmpdir(), 'swi-verify-repo-'))
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

  const pacote = join(mkdtempSync(join(tmpdir(), 'swi-verify-out-')), 'entrega')
  exportSnapshot({ repo, out: pacote })
  return { repo, pacote }
}

const arquivo = (pacote, rel) => join(pacote, ...rel.split('/'))

/** Roda o verificador esperando reprovação e devolve a mensagem do erro. */
const motivo = (cenario) => {
  try {
    verifyDelivery({ input: cenario.pacote, repo: cenario.repo })
  } catch (erro) {
    return erro.message
  }
  return assert.fail('o verificador aceitou um pacote que deveria recusar')
}

// ---------------------------------------------------------------------------
// Caminho feliz: é a linha de base que dá sentido a toda reprovação abaixo.
// ---------------------------------------------------------------------------

test('aceita o pacote recém-exportado do commit', () => {
  const { repo, pacote } = criaCenario()
  const resultado = verifyDelivery({ input: pacote, repo })

  // Cinco payloads de texto no fixture: index.tsx, crlf.ts, NOTICE.txt,
  // icon.svg e .env.example. O PNG, o tgz, o .env.production e o markdown
  // ficam de fora por classificação, e é isso que a contagem afirma.
  assert.equal(resultado.arquivos, 5)
  assert.match(resultado.commit, /^[0-9a-f]{40}$/)
})

// ---------------------------------------------------------------------------
// Integridade do conteúdo. Sem manifesto dentro do pacote, a referência é o
// próprio commit: o verificador relê o blob.
// ---------------------------------------------------------------------------

test('detecta payload alterado', () => {
  const cenario = criaCenario()
  appendFileSync(arquivo(cenario.pacote, 'data/mobile/app/index.tsx.txt'), 'x')

  assert.match(motivo(cenario), /index\.tsx/)
})

test('detecta payload esvaziado', () => {
  const cenario = criaCenario()
  writeFileSync(arquivo(cenario.pacote, 'data/mobile/NOTICE.txt.txt'), '')

  assert.match(motivo(cenario), /NOTICE\.txt/)
})

test('detecta normalização desfeita: CRLF de volta no payload', () => {
  const cenario = criaCenario()
  writeFileSync(arquivo(cenario.pacote, 'data/mobile/app/crlf.ts.txt'), 'linha1\r\nlinha2\r\n')

  assert.match(motivo(cenario), /crlf\.ts/)
})

test('detecta BOM reintroduzido no payload', () => {
  const cenario = criaCenario()
  writeFileSync(
    arquivo(cenario.pacote, 'data/mobile/app/index.tsx.txt'),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('const a = 1\n')]),
  )

  assert.match(motivo(cenario), /index\.tsx/)
})

// ---------------------------------------------------------------------------
// Forma do pacote: só TXT, dentro de data/, e nada além do que o commit tem.
// ---------------------------------------------------------------------------

test('detecta arquivo não TXT dentro do pacote', () => {
  const cenario = criaCenario()
  writeFileSync(arquivo(cenario.pacote, 'data/rogue.png'), Buffer.from([0]))

  assert.match(motivo(cenario), /rogue\.png/)
})

test('detecta arquivo fora de data/', () => {
  const cenario = criaCenario()
  writeFileSync(arquivo(cenario.pacote, 'LEIAME.txt'), 'oi\n')

  assert.match(motivo(cenario), /LEIAME\.txt/)
})

test('detecta payload que não corresponde a nenhum arquivo do commit', () => {
  const cenario = criaCenario()
  escreve(cenario.pacote, 'data/mobile/app/inventado.ts.txt', 'const x = 1\n')

  assert.match(motivo(cenario), /inventado\.ts/)
})

test('detecta payload que faltou no pacote', () => {
  const cenario = criaCenario()
  rmSync(arquivo(cenario.pacote, 'data/mobile/assets/icon.svg.txt'))

  assert.match(motivo(cenario), /icon\.svg/)
})

test('detecta classe excluída entregue por engano', () => {
  const cenario = criaCenario()
  // O caso que mais dói: um .env de VALOR dentro do pacote, com o conteúdo
  // batendo com o blob do commit. Casar com o repositório não pode ser
  // suficiente; o que decide é a classificação.
  escreve(
    cenario.pacote,
    'data/swi-admin/.env.production.txt',
    'VITE_API_URL=https://painel.exemplo.com\n',
  )

  assert.match(motivo(cenario), /\.env\.production/)
})

test('detecta documentação entregue por engano', () => {
  const cenario = criaCenario()
  escreve(cenario.pacote, 'data/docs/plans/a.md.txt', '# plano\n')

  assert.match(motivo(cenario), /docs\/plans/)
})

// ---------------------------------------------------------------------------
// Nomes: o pacote vai atravessar sistemas de arquivo que não distinguem caixa.
// ---------------------------------------------------------------------------

// A checagem é exercitada como função pura, e não gravando o par no disco, por
// um motivo de plataforma: em NTFS e APFS o segundo `write` não cria arquivo
// nenhum, ele SOBRESCREVE o primeiro. O cenário que o verificador precisa pegar
// só existe depois que o pacote atravessa um sistema de arquivo sensível a
// caixa, que é justamente onde ele não seria produzido nesta máquina.
test('recusa nomes que colidem sem distinção de caixa ou por Unicode', () => {
  assert.throws(
    () => assertNomesSeguros(['data/mobile/app/index.tsx.txt', 'data/mobile/app/INDEX.tsx.txt']),
    /INDEX\.tsx/i,
  )
  // 'é' precomposto (U+00E9) contra 'e' + acento combinante (U+0301). As duas
  // strings abaixo são IDÊNTICAS na tela e diferentes em bytes; conferir com
  // `git diff` ou `cat -A` antes de "corrigir" o que parece duplicado.
  assert.throws(
    () => assertNomesSeguros(['data/mobile/café.ts.txt', 'data/mobile/café.ts.txt']),
    /colis/i,
  )
  assert.doesNotThrow(() => assertNomesSeguros(['data/mobile/a.ts.txt', 'data/mobile/b.ts.txt']))
})

test('recusa caminho com traversal, absoluto ou separador de Windows', () => {
  assert.throws(() => assertNomesSeguros(['data/../fora.txt']), /fora\.txt/)
  assert.throws(() => assertNomesSeguros(['/etc/passwd.txt']), /passwd/)
  assert.throws(() => assertNomesSeguros(['data\\mobile\\a.ts.txt']), /a\.ts/)
})

// ---------------------------------------------------------------------------
// Segredos: a última rede antes de o pacote sair da máquina.
// ---------------------------------------------------------------------------

test('detecta chave privada dentro de um payload', () => {
  const cenario = criaCenario()
  appendFileSync(
    arquivo(cenario.pacote, 'data/mobile/app/index.tsx.txt'),
    '\n// -----BEGIN RSA PRIVATE KEY-----\n',
  )

  assert.match(motivo(cenario), /segredo/i)
})

test('detecta chave de acesso AWS dentro de um payload', () => {
  const cenario = criaCenario()
  // Identificador de exemplo da própria documentação da AWS, sem valor real.
  appendFileSync(
    arquivo(cenario.pacote, 'data/mobile/app/index.tsx.txt'),
    '\nconst k = "AKIAIOSFODNN7EXAMPLE"\n',
  )

  assert.match(motivo(cenario), /segredo/i)
})

// ---------------------------------------------------------------------------
// Entrada inválida: falta de pacote não pode passar por pacote aprovado.
// ---------------------------------------------------------------------------

test('recusa pacote inexistente', () => {
  const { repo } = criaCenario()
  const vazio = mkdtempSync(join(tmpdir(), 'swi-verify-vazio-'))

  assert.throws(() => verifyDelivery({ input: join(vazio, 'nao-existe'), repo }), /não existe/i)
})

test('recusa pacote sem data/', () => {
  const { repo } = criaCenario()
  const vazio = mkdtempSync(join(tmpdir(), 'swi-verify-vazio-'))

  assert.throws(() => verifyDelivery({ input: vazio, repo }), /data\//)
})

test('não confunde o pacote com o de outro commit', () => {
  const cenario = criaCenario()
  // Um commit novo muda o conteúdo esperado. O pacote antigo tem que reprovar,
  // senão nada impede entregar um snapshot que não é o aprovado.
  escreve(cenario.repo, 'mobile/app/index.tsx', 'const a = 2\n')
  git(cenario.repo, 'add', '-A')
  git(cenario.repo, 'commit', '-q', '-m', 'muda o app')

  assert.match(motivo(cenario), /index\.tsx/)
})
