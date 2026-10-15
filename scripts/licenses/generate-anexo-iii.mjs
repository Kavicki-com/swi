/**
 * Gera o ANEXO-III-LICENCAS.md da raiz: as bibliotecas de terceiros que os
 * três projetos usam diretamente, com versão instalada e licença.
 *
 * A fonte é o package.json de cada pacote dentro de node_modules, e não o
 * package.json do projeto. O do projeto declara uma faixa ("^10.4.0"); o que
 * vai para o produto é a versão que o lockfile resolveu, e a licença só existe
 * no manifesto do próprio pacote. Por isso o gerador exige as dependências
 * instaladas (`npm ci` em cada projeto) e falha se alguma faltar, em vez de
 * escrever uma linha sem versão.
 *
 * Saída determinística: nada depende de data, máquina ou ordem do disco. Assim
 * `--check` consegue dizer se o arquivo versionado ainda bate com a árvore.
 *
 * Uso:
 *   node scripts/licenses/generate-anexo-iii.mjs           escreve o arquivo
 *   node scripts/licenses/generate-anexo-iii.mjs --check   só confere
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_PADRAO = join(AQUI, '..', '..')
export const ARQUIVO_SAIDA = 'ANEXO-III-LICENCAS.md'

export const PROJETOS = [
  { pasta: 'swi-backend', titulo: 'API (`swi-backend`)' },
  { pasta: 'swi-admin', titulo: 'Painel web (`swi-admin`)' },
  { pasta: 'mobile', titulo: 'App do trabalhador (`mobile`)' },
]

/** Biblioteca da própria Kavicki: não é de terceiro e não entra na triagem de licença. */
export const BIBLIOTECA_PROPRIA = '@kavicki/swi-design-system'

/** Licenças que não pedem atenção. Qualquer outra é marcada no documento. */
const PERMISSIVAS = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD'])

/**
 * Licença declarada no manifesto. O campo moderno é uma string SPDX; pacotes
 * antigos usam objeto `{ type }` ou a lista `licenses`, que vira uma expressão
 * com OR, porque a lista declara alternativas.
 */
export function licencaDeclarada(manifesto) {
  const { license, licenses } = manifesto
  if (typeof license === 'string' && license.trim() !== '') return license.trim()
  if (license && typeof license.type === 'string') return license.type.trim()
  if (Array.isArray(licenses) && licenses.length > 0) {
    const tipos = licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean)
    if (tipos.length === 1) return tipos[0]
    if (tipos.length > 1) return `(${tipos.join(' OR ')})`
  }
  return 'não declarada'
}

/**
 * Uma expressão SPDX é permissiva quando ao menos uma alternativa (OR) tem
 * todos os termos (AND) na lista. Com OR quem usa escolhe a licença; com AND
 * valem todas ao mesmo tempo.
 */
export function ehPermissiva(expressao) {
  const limpa = expressao.replace(/[()]/g, ' ').trim()
  if (limpa === '') return false
  return limpa.split(/\s+OR\s+/i).some((alternativa) =>
    alternativa
      .split(/\s+AND\s+/i)
      .map((termo) => termo.trim())
      .every((termo) => PERMISSIVAS.has(termo)),
  )
}

function lerJson(caminho) {
  return JSON.parse(readFileSync(caminho, 'utf8'))
}

/**
 * Lê as dependências diretas de um projeto já instalado. Devolve as duas
 * listas ordenadas por nome; falha nomeando o pacote que não está em
 * node_modules.
 */
export function coletarProjeto(raiz, pasta) {
  const manifesto = lerJson(join(raiz, pasta, 'package.json'))
  const ler = (bloco) =>
    Object.keys(manifesto[bloco] ?? {})
      .sort((a, b) => a.localeCompare(b, 'en'))
      .map((nome) => {
        const caminho = join(raiz, pasta, 'node_modules', ...nome.split('/'), 'package.json')
        if (!existsSync(caminho)) {
          throw new Error(`${pasta}: ${nome} não está instalado. Rode "npm ci" em ${pasta} antes de gerar o anexo.`)
        }
        const instalado = lerJson(caminho)
        const propria = nome === BIBLIOTECA_PROPRIA
        const licenca = propria ? 'Proprietária (Kavicki)' : licencaDeclarada(instalado)
        return {
          nome,
          // Dependência por alias ("react-native": "npm:react-native-web@...")
          // instala outro pacote sob o nome pedido. A licença é a dele.
          pacoteReal: instalado.name && instalado.name !== nome ? instalado.name : undefined,
          versao: instalado.version ?? 'desconhecida',
          licenca,
          propria,
          atencao: !propria && !ehPermissiva(licenca),
        }
      })
  return { dependencies: ler('dependencies'), devDependencies: ler('devDependencies') }
}

function celula(texto) {
  return String(texto).replace(/\|/g, '\\|')
}

function tabela(itens) {
  if (itens.length === 0) return ['Nenhuma.', '']
  const linhas = ['| Pacote | Versão | Licença | Observação |', '| --- | --- | --- | --- |']
  for (const item of itens) {
    const obs = []
    if (item.propria) obs.push('Biblioteca própria da Kavicki')
    if (item.pacoteReal) obs.push(`Instala \`${item.pacoteReal}\` sob este nome`)
    if (item.atencao) obs.push('**Atenção: licença fora de MIT, ISC, BSD e Apache-2.0**')
    linhas.push(
      `| \`${celula(item.nome)}\` | ${celula(item.versao)} | ${celula(item.licenca)} | ${celula(obs.join('. '))} |`,
    )
  }
  return [...linhas, '']
}

/** Monta o markdown a partir do que foi coletado. Pura, para poder ser testada. */
export function montarDocumento(coletas) {
  const saida = [
    '# Anexo III: bibliotecas de terceiros e licenças',
    '',
    'Relação das bibliotecas usadas diretamente pelos três projetos do SWI, com a versão instalada pelo lockfile de cada um e a licença declarada pelo próprio pacote.',
    '',
    'Cada biblioteca permanece sob a própria licença, e nada neste anexo altera esses termos. As dependências transitivas (as dependências das bibliotecas listadas) também seguem as próprias licenças, que acompanham cada pacote em `node_modules/` após a instalação; a árvore completa de cada projeto pode ser listada com `npm ls --all`.',
    '',
    '- **Dependências de execução** (`dependencies`) fazem parte do produto em funcionamento.',
    '- **Dependências de desenvolvimento** (`devDependencies`) só são usadas para compilar, testar e verificar o código, e não são distribuídas com o produto.',
    '',
    `A biblioteca \`${BIBLIOTECA_PROPRIA}\` é o design system do SWI, de propriedade da Kavicki, e não é de terceiro. Ela acompanha o código-fonte como pacote em \`vendor/\` no painel e no app.`,
    '',
    'Licenças fora de MIT, ISC, BSD e Apache-2.0 são marcadas com **Atenção** e reunidas na seção final.',
    '',
    'Este arquivo é gerado por `node scripts/licenses/generate-anexo-iii.mjs` a partir das dependências instaladas (`npm ci` em cada projeto). Não edite à mão: rode o gerador de novo depois de qualquer mudança de dependência.',
    '',
  ]

  const marcadas = []
  for (const { projeto, coleta } of coletas) {
    saida.push(`## ${projeto.titulo}`, '')
    saida.push('### Dependências de execução', '', ...tabela(coleta.dependencies))
    saida.push('### Dependências de desenvolvimento', '', ...tabela(coleta.devDependencies))
    for (const [bloco, itens] of [
      ['execução', coleta.dependencies],
      ['desenvolvimento', coleta.devDependencies],
    ]) {
      for (const item of itens) if (item.atencao) marcadas.push({ projeto, bloco, item })
    }
  }

  saida.push('## Licenças que pedem atenção', '')
  if (marcadas.length === 0) {
    saida.push('Nenhuma. Todas as dependências diretas de terceiros usam MIT, ISC, BSD ou Apache-2.0.', '')
  } else {
    saida.push('| Projeto | Pacote | Versão | Licença | Tipo |', '| --- | --- | --- | --- | --- |')
    for (const { projeto, bloco, item } of marcadas) {
      saida.push(
        `| \`${projeto.pasta}\` | \`${celula(item.nome)}\` | ${celula(item.versao)} | ${celula(item.licenca)} | ${bloco} |`,
      )
    }
    saida.push('')
  }

  return saida.join('\n')
}

export function gerar(raiz = RAIZ_PADRAO) {
  const coletas = PROJETOS.map((projeto) => ({ projeto, coleta: coletarProjeto(raiz, projeto.pasta) }))
  return montarDocumento(coletas)
}

export function main(argv = [], raiz = RAIZ_PADRAO) {
  const documento = gerar(raiz)
  const destino = join(raiz, ARQUIVO_SAIDA)
  if (argv.includes('--check')) {
    const atual = existsSync(destino) ? readFileSync(destino, 'utf8') : ''
    if (atual !== documento) {
      console.error(`${ARQUIVO_SAIDA} está desatualizado. Rode: node scripts/licenses/generate-anexo-iii.mjs`)
      return 1
    }
    console.log(`${ARQUIVO_SAIDA} confere com as dependências instaladas.`)
    return 0
  }
  writeFileSync(destino, documento)
  console.log(`${ARQUIVO_SAIDA} gerado.`)
  return 0
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (erro) {
    console.error(erro.message)
    process.exitCode = 1
  }
}
