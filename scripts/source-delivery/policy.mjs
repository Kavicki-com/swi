/**
 * Política determinística de seleção da entrega de código-fonte.
 *
 * Tudo aqui é allowlist explícita: um caminho só vira payload quando alguma
 * regra o inclui, e o que nenhuma regra reconhece cai no inventário de
 * binários, nunca dentro do pacote em silêncio. A ordem das regras importa e
 * está documentada em classify().
 *
 * O mapeamento de nomes é literal e reversível: um único sufixo .txt somado ao
 * caminho original, mesmo quando a origem já termina em .txt (NOTICE.txt vira
 * NOTICE.txt.txt, e o verificador desfaz sem ambiguidade).
 */

/** Raízes permitidas da entrega. Fora delas nada entra. */
const RAIZES = new Set(['mobile', 'swi-admin', 'swi-backend'])

/**
 * Extensões de texto entregáveis: código, testes, migrations, schemas,
 * manifests, lockfiles, configs textuais e SVG. Markdown fica de fora de
 * propósito: a entrega é o código, documentação não acompanha.
 */
const EXTENSOES_TEXTO = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'svg', 'yml', 'yaml', 'toml', 'xml',
  'html', 'css', 'scss',
  'sql', 'prisma', 'sh',
  'txt', 'tsv', 'example', 'properties', 'gradle',
])

/** Configs textuais que não têm extensão convencional. */
const NOMES_TEXTO = new Set([
  '.gitignore', '.gitattributes', '.npmrc', '.nvmrc',
  '.editorconfig', '.dockerignore', '.easignore',
  '.eslintignore', '.prettierignore', '.prettierrc', '.eslintrc',
  'Dockerfile',
])

/** Diretórios de artefato: build, cache, cobertura, resultado de teste, temporários. */
const SEGMENTOS_BUILD = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out',
  'coverage', 'test-results', 'playwright-report', 'storybook-static',
  '.expo', '.cache', '.next', '.turbo', 'tmp', 'screenshots',
])

function segmentosDe(caminho) {
  return caminho.split('/')
}

function nomeBase(caminho) {
  const seg = segmentosDe(caminho)
  return seg[seg.length - 1]
}

function extensaoDe(nome) {
  const ponto = nome.lastIndexOf('.')
  if (ponto <= 0) return ''
  return nome.slice(ponto + 1).toLowerCase()
}

/**
 * Caminho relativo POSIX vindo do Git. Absoluto, com drive, com backslash ou
 * com traversal é sinal de origem corrompida: aborta, nunca acomoda.
 */
function validaRelativo(caminho) {
  if (typeof caminho !== 'string' || caminho.length === 0) {
    throw new Error('caminho vazio não é entregável')
  }
  if (caminho.startsWith('/') || /^[A-Za-z]:/.test(caminho)) {
    throw new Error(`caminho absoluto recusado: ${caminho}`)
  }
  if (caminho.includes('\\')) {
    throw new Error(`separador de Windows recusado: ${caminho}`)
  }
  const seg = segmentosDe(caminho)
  if (seg.some((s) => s === '..' || s === '.' || s === '')) {
    throw new Error(`traversal ou segmento vazio recusado: ${caminho}`)
  }
  return caminho
}

/** Caminho físico dentro do pacote: data/<original>.txt, sempre. */
export function deliveryPath(original) {
  validaRelativo(original)
  return `data/${original}.txt`
}

/** Classifica um caminho do snapshot. A primeira regra que casar decide. */
export function classify(caminho) {
  const seg = segmentosDe(caminho)

  // Fora das raízes permitidas nada entra; docs ganha categoria própria
  // porque o relatório de exclusões separa documentação de infraestrutura.
  if (seg[0] === 'docs') return 'excluded-docs'
  if (!RAIZES.has(seg[0])) return 'excluded-scope'

  const dentro = seg.slice(1)
  if (dentro.includes('amplify')) return 'excluded-legacy'
  if (dentro.includes('vendor')) return 'excluded-vendor'
  if (dentro.includes('docs')) return 'excluded-docs'
  if (dentro.some((s) => SEGMENTOS_BUILD.has(s))) return 'excluded-build'

  const nome = nomeBase(caminho)
  if (nome.startsWith('.env')) {
    return nome === '.env.example' ? 'payload-text' : 'excluded-env'
  }

  const ext = extensaoDe(nome)
  if (ext === 'md' || ext === 'mdx') return 'excluded-docs'
  if (NOMES_TEXTO.has(nome) || EXTENSOES_TEXTO.has(ext)) return 'payload-text'

  // Sem regra que inclua: vai pro inventário de binários com o caminho, o
  // tamanho e o hash registrados, e o pacote segue sem o conteúdo.
  return 'binary-inventory'
}

/**
 * Normaliza um payload de texto: UTF-8 sem BOM, quebras LF. NUL ou bytes que
 * não decodificam como UTF-8 provam que o arquivo não é texto entregável.
 */
export function normalizeText(buffer) {
  if (buffer.includes(0)) {
    throw new Error('payload contém byte NUL, não é texto entregável')
  }
  let texto
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error('payload não é UTF-8 válido')
  }
  if (texto.startsWith('﻿')) texto = texto.slice(1)
  return texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Dois caminhos que colidem após NFC ou comparação case-insensitive virariam
 * um só arquivo em sistemas de arquivo insensíveis: aborta nomeando o par,
 * nunca escolhe um dos dois em silêncio.
 */
export function assertNoCollisions(caminhos) {
  const vistos = new Map()
  for (const caminho of caminhos) {
    const chave = caminho.normalize('NFC').toLowerCase()
    const anterior = vistos.get(chave)
    if (anterior !== undefined) {
      throw new Error(`colisão de caminho na entrega: ${anterior} e ${caminho}`)
    }
    vistos.set(chave, caminho)
  }
}
