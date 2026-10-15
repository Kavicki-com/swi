import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ARQUIVO_SAIDA,
  BIBLIOTECA_PROPRIA,
  coletarProjeto,
  ehPermissiva,
  licencaDeclarada,
  main,
  montarDocumento,
} from './generate-anexo-iii.mjs'

// O anexo responde a uma exigência de contrato: dizer ao cliente quais
// bibliotecas de terceiros o produto usa e sob qual licença. Os dois erros que
// importam são uma licença restritiva passar sem marca e uma linha sair com
// versão ou licença inventada. Os testes cercam os dois.

function escrever(caminho, objeto) {
  mkdirSync(join(caminho, '..'), { recursive: true })
  writeFileSync(caminho, JSON.stringify(objeto))
}

/** Monta uma raiz falsa com os três projetos e um node_modules mínimo em cada um. */
function raizFalsa({ semInstalar = [] } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'anexo-iii-'))
  const instalar = (pasta, nome, manifesto) => {
    if (semInstalar.includes(nome)) return
    escrever(join(raiz, pasta, 'node_modules', ...nome.split('/'), 'package.json'), { name: nome, ...manifesto })
  }
  escrever(join(raiz, 'swi-backend', 'package.json'), {
    dependencies: { express: '^4.0.0' },
    devDependencies: { jest: '^29.0.0' },
  })
  instalar('swi-backend', 'express', { version: '4.21.2', license: 'MIT' })
  instalar('swi-backend', 'jest', { version: '29.7.0', license: 'MIT' })

  escrever(join(raiz, 'swi-admin', 'package.json'), {
    dependencies: { [BIBLIOTECA_PROPRIA]: 'file:./vendor/ds.tgz', 'maplibre-gl': '^6.0.0' },
    devDependencies: { 'react-native': 'npm:react-native-web@^0.19.0' },
  })
  instalar('swi-admin', BIBLIOTECA_PROPRIA, { version: '0.1.139' })
  instalar('swi-admin', 'maplibre-gl', { version: '6.11.2', license: 'BSD-3-Clause' })
  escrever(join(raiz, 'swi-admin', 'node_modules', 'react-native', 'package.json'), {
    name: 'react-native-web',
    version: '0.19.13',
    license: 'MIT',
  })

  escrever(join(raiz, 'mobile', 'package.json'), {
    dependencies: { 'cep-promise': '^4.4.1', three: '^0.166.1' },
  })
  instalar('mobile', 'cep-promise', { version: '4.4.1', license: 'MIT' })
  instalar('mobile', 'three', { version: '0.166.1', license: 'GPL-3.0' })
  return raiz
}

test('licenca declarada como string SPDX, objeto antigo ou lista antiga', () => {
  assert.equal(licencaDeclarada({ license: 'MIT' }), 'MIT')
  assert.equal(licencaDeclarada({ license: { type: 'BSD-3-Clause' } }), 'BSD-3-Clause')
  assert.equal(licencaDeclarada({ licenses: [{ type: 'MIT' }] }), 'MIT')
  assert.equal(licencaDeclarada({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }), '(MIT OR Apache-2.0)')
})

test('pacote sem licenca declarada aparece como nao declarada, nunca como MIT', () => {
  assert.equal(licencaDeclarada({}), 'não declarada')
  assert.equal(licencaDeclarada({ license: '  ' }), 'não declarada')
  assert.equal(ehPermissiva('não declarada'), false)
})

test('MIT, ISC, BSD e Apache-2.0 nao pedem atencao', () => {
  for (const licenca of ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0']) {
    assert.equal(ehPermissiva(licenca), true, licenca)
  }
})

test('qualquer outra licenca pede atencao', () => {
  for (const licenca of ['GPL-3.0', 'LGPL-2.1', 'MPL-2.0', 'CC-BY-4.0', '0BSD', 'UNLICENSED', 'SEE LICENSE IN LICENSE']) {
    assert.equal(ehPermissiva(licenca), false, licenca)
  }
})

test('com OR basta uma alternativa permissiva; com AND todas precisam ser', () => {
  assert.equal(ehPermissiva('(MIT OR GPL-3.0)'), true)
  assert.equal(ehPermissiva('(MIT AND CC-BY-3.0)'), false)
  assert.equal(ehPermissiva('(MIT AND Apache-2.0)'), true)
})

test('coleta versao instalada e licenca do node_modules, em ordem alfabetica', () => {
  const raiz = raizFalsa()
  try {
    const { dependencies } = coletarProjeto(raiz, 'mobile')
    assert.deepEqual(
      dependencies.map((d) => [d.nome, d.versao, d.licenca, d.atencao]),
      [
        ['cep-promise', '4.4.1', 'MIT', false],
        ['three', '0.166.1', 'GPL-3.0', true],
      ],
    )
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test('dependencia por alias mostra o pacote que de fato foi instalado', () => {
  const raiz = raizFalsa()
  try {
    const [alias] = coletarProjeto(raiz, 'swi-admin').devDependencies
    assert.equal(alias.nome, 'react-native')
    assert.equal(alias.pacoteReal, 'react-native-web')
    assert.equal(alias.versao, '0.19.13')
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test('o design system entra como biblioteca propria, sem marca de atencao', () => {
  const raiz = raizFalsa()
  try {
    const ds = coletarProjeto(raiz, 'swi-admin').dependencies.find((d) => d.nome === BIBLIOTECA_PROPRIA)
    assert.equal(ds.propria, true)
    assert.equal(ds.atencao, false)
    assert.equal(ds.licenca, 'Proprietária (Kavicki)')
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test('dependencia nao instalada aborta nomeando o pacote, em vez de sair sem versao', () => {
  const raiz = raizFalsa({ semInstalar: ['jest'] })
  try {
    assert.throws(() => coletarProjeto(raiz, 'swi-backend'), /jest não está instalado.*npm ci/)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test('o documento separa execucao de desenvolvimento e reune as marcadas no fim', () => {
  const raiz = raizFalsa()
  try {
    const projeto = { pasta: 'mobile', titulo: 'App' }
    const doc = montarDocumento([{ projeto, coleta: coletarProjeto(raiz, 'mobile') }])
    assert.match(doc, /### Dependências de execução\n\n\| Pacote/)
    assert.match(doc, /### Dependências de desenvolvimento\n\nNenhuma\./)
    assert.match(doc, /\| `three` \| 0\.166\.1 \| GPL-3\.0 \| \*\*Atenção/)
    const final = doc.slice(doc.indexOf('## Licenças que pedem atenção'))
    assert.match(final, /\| `mobile` \| `three` \| 0\.166\.1 \| GPL-3\.0 \| execução \|/)
    assert.doesNotMatch(final, /cep-promise/)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test('sem licenca marcada a secao final diz isso explicitamente', () => {
  const doc = montarDocumento([
    { projeto: { pasta: 'x', titulo: 'X' }, coleta: { dependencies: [], devDependencies: [] } },
  ])
  assert.match(doc, /## Licenças que pedem atenção\n\nNenhuma\./)
})

test('a saida e deterministica e o --check acusa arquivo desatualizado', () => {
  const raiz = raizFalsa()
  const log = console.log
  const erro = console.error
  console.log = () => {}
  console.error = () => {}
  try {
    assert.equal(main(['--check'], raiz), 1)
    assert.equal(main([], raiz), 0)
    const primeira = readFileSync(join(raiz, ARQUIVO_SAIDA), 'utf8')
    assert.equal(main(['--check'], raiz), 0)
    assert.equal(main([], raiz), 0)
    assert.equal(readFileSync(join(raiz, ARQUIVO_SAIDA), 'utf8'), primeira)
  } finally {
    console.log = log
    console.error = erro
    rmSync(raiz, { recursive: true, force: true })
  }
})
