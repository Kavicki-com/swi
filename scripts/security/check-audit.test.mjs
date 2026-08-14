import test from 'node:test'
import assert from 'node:assert/strict'
import { avaliar, MAX_DIAS_DE_EXCECAO } from './check-audit.mjs'

// O portao existe para responder uma pergunta so: "esta arvore pode ser
// entregue?". Ele bloqueia critical e high; moderate e low entram no relatorio
// e nao param a entrega, porque um portao que nasce vermelho sem acao possivel
// vira ruido e as pessoas passam a ignora-lo.
//
// A excecao e o ponto delicado: ela precisa custar alguma coisa, senao vira o
// caminho padrao. Por isso expira, exige responsavel e justificativa, e o
// vencimento BLOQUEIA em vez de avisar.

const HOJE = new Date('2026-08-14T12:00:00Z')

const achado = (over = {}) => ({
  projeto: 'swi-backend',
  pacote: 'multer',
  severidade: 'high',
  ...over,
})

const excecao = (over = {}) => ({
  projeto: 'swi-backend',
  pacote: 'multer',
  advisories: ['GHSA-fake-0000'],
  justificativa: 'texto suficientemente longo explicando por que nao alcanca o produto',
  responsavel: 'Gabriel Fernandes <design@kavicki.com>',
  declaradaEm: '2026-08-14',
  expiraEm: '2026-11-12',
  ...over,
})

test('achado high sem excecao bloqueia', () => {
  const r = avaliar({ achados: [achado()], excecoes: [], hoje: HOJE })
  assert.equal(r.bloqueios.length, 1)
  assert.match(r.bloqueios[0].motivo, /sem exce/i)
})

test('achado critical sem excecao bloqueia', () => {
  const r = avaliar({ achados: [achado({ severidade: 'critical' })], excecoes: [], hoje: HOJE })
  assert.equal(r.bloqueios.length, 1)
})

test('moderate e low nao bloqueiam, mas aparecem no relatorio', () => {
  const r = avaliar({
    achados: [achado({ severidade: 'moderate' }), achado({ severidade: 'low' })],
    excecoes: [],
    hoje: HOJE,
  })
  assert.equal(r.bloqueios.length, 0)
  assert.equal(r.informativos.length, 2)
})

test('excecao vigente cobre o achado', () => {
  const r = avaliar({ achados: [achado()], excecoes: [excecao()], hoje: HOJE })
  assert.equal(r.bloqueios.length, 0)
  assert.equal(r.cobertos.length, 1)
})

// Uma excecao so vale para o par projeto+pacote que ela declara. Sem isto,
// "multer" liberado no backend liberaria "multer" no mobile de graca.
test('excecao de um projeto nao cobre outro', () => {
  const r = avaliar({
    achados: [achado({ projeto: 'mobile' })],
    excecoes: [excecao()],
    hoje: HOJE,
  })
  assert.equal(r.bloqueios.length, 1)
})

test('excecao vencida bloqueia, em vez de so avisar', () => {
  const r = avaliar({
    achados: [achado()],
    excecoes: [excecao({ declaradaEm: '2026-01-01', expiraEm: '2026-04-01' })],
    hoje: HOJE,
  })
  assert.equal(r.bloqueios.length, 1)
  assert.match(r.bloqueios[0].motivo, /vencid/i)
})

// Sem teto, "expira em 2099" seria excecao permanente com aparencia de
// temporaria.
test('excecao com prazo maior que o teto bloqueia', () => {
  const r = avaliar({
    achados: [achado()],
    excecoes: [excecao({ declaradaEm: '2026-08-14', expiraEm: '2027-08-14' })],
    hoje: HOJE,
  })
  assert.equal(r.bloqueios.length, 1)
  assert.match(r.bloqueios[0].motivo, new RegExp(String(MAX_DIAS_DE_EXCECAO)))
})

test('o teto e de 90 dias', () => {
  assert.equal(MAX_DIAS_DE_EXCECAO, 90)
})

// Campo faltando e erro de quem escreveu a excecao, nao licenca para passar:
// uma excecao sem responsavel nao tem a quem cobrar quando vencer.
for (const campo of ['justificativa', 'responsavel', 'declaradaEm', 'expiraEm', 'advisories']) {
  test(`excecao sem ${campo} bloqueia`, () => {
    const incompleta = excecao()
    delete incompleta[campo]
    const r = avaliar({ achados: [achado()], excecoes: [incompleta], hoje: HOJE })
    assert.equal(r.bloqueios.length, 1, `esperado bloqueio por falta de ${campo}`)
    assert.match(r.bloqueios[0].motivo, new RegExp(campo, 'i'))
  })
}

// Justificativa de uma palavra nao e justificativa. O limite e baixo de
// proposito: nao existe para medir prosa, existe para impedir "ok" e "n/a".
test('justificativa vazia ou curta demais bloqueia', () => {
  const r = avaliar({
    achados: [achado()],
    excecoes: [excecao({ justificativa: 'ok' })],
    hoje: HOJE,
  })
  assert.equal(r.bloqueios.length, 1)
  assert.match(r.bloqueios[0].motivo, /justificativa/i)
})

// Excecao que nao corresponde a achado nenhum e lixo acumulando: o pacote foi
// corrigido ou removido e ninguem limpou. Nao bloqueia a entrega, mas precisa
// aparecer, senao a lista so cresce.
test('excecao que nao cobre nenhum achado e reportada como obsoleta', () => {
  const r = avaliar({ achados: [], excecoes: [excecao()], hoje: HOJE })
  assert.equal(r.bloqueios.length, 0)
  assert.equal(r.obsoletas.length, 1)
})
