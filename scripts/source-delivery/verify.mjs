/**
 * Verificador independente da entrega de código-fonte.
 *
 * Roda DEPOIS do exportador e contra o mesmo commit aprovado, respondendo uma
 * pergunta só: o que está nesta pasta é exatamente o código daquele commit,
 * inteiro, em texto, e nada além disso?
 *
 * Por que ele existe mesmo sendo o exportador determinístico: o pacote é
 * copiado, compactado, mandado adiante e aberto em outra máquina, e é entre a
 * geração e a entrega que um arquivo se perde, um editor grava CRLF de volta,
 * ou alguém acrescenta "só um README" na pasta. Nada disso é falha do
 * exportador, e tudo isso muda o que o cliente recebe.
 *
 * INDEPENDÊNCIA, e onde ela para: a normalização de texto é reimplementada
 * aqui de propósito, para que um erro nela apareça como divergência em vez de
 * se cancelar dos dois lados. Já a CLASSIFICAÇÃO vem de policy.mjs, e isso
 * também é deliberado: a política é a especificação do que a entrega contém,
 * não um detalhe do exportador. Duplicá-la criaria duas listas para manter, e
 * a cópia errada acabaria virando o gabarito.
 *
 * Sem manifesto dentro do pacote (decisão do responsável: o contrato pede o
 * código, e nada mais), a referência de integridade é o
 * próprio commit. Por isso o verificador exige o repositório.
 *
 * Uso:
 *   node scripts/source-delivery/verify.mjs --input <dir> [--repo <dir>] [--commit <ref>]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { classify, deliveryPath } from './policy.mjs'

/**
 * Padrões de segredo de alto sinal: formatos que ninguém escreve por acaso.
 * A lista é curta de propósito. Um detector que também acusa senha de exemplo
 * e string parecida com token vira ruído, e um portão que grita sempre é um
 * portão que se aprende a ignorar.
 */
const PADROES_DE_SEGREDO = [
  { nome: 'chave privada', regex: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/ },
  { nome: 'chave de acesso AWS', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { nome: 'token do GitHub', regex: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
  { nome: 'token do Slack', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
]

/** Junta os problemas de uma etapa numa falha só, para não corrigir a conta-gotas. */
function reprova(titulo, problemas) {
  if (problemas.length === 0) return
  throw new Error(`${titulo}:\n  ${problemas.join('\n  ')}`)
}

/**
 * Normalização de texto reimplementada.
 *
 * Escrita com split/join e código de ponto explícito, e não com as expressões
 * de policy.mjs, porque copiar a implementação de lá tornaria a comparação
 * incapaz de enxergar um erro nela: os dois lados errariam igual e o pacote
 * passaria.
 */
export function normalizaParaComparar(buffer) {
  if (buffer.includes(0)) throw new Error('contém byte NUL')
  let texto
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error('não é UTF-8 válido')
  }
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1)
  return texto.split('\r\n').join('\n').split('\r').join('\n')
}

/**
 * Valida a forma dos caminhos do pacote: todos sob data/, todos .txt, nenhum
 * capaz de escapar do diretório ao ser extraído, e nenhum par que vire um só
 * arquivo em sistema de arquivo insensível a caixa.
 */
export function assertNomesSeguros(caminhos) {
  const problemas = []
  const vistos = new Map()

  for (const caminho of caminhos) {
    if (caminho.includes('\\')) {
      problemas.push(`separador de Windows no caminho: ${caminho}`)
      continue
    }
    if (caminho.startsWith('/') || /^[A-Za-z]:/.test(caminho)) {
      problemas.push(`caminho absoluto: ${caminho}`)
      continue
    }
    const seg = caminho.split('/')
    if (seg.some((s) => s === '..' || s === '.' || s === '')) {
      problemas.push(`traversal ou segmento vazio: ${caminho}`)
      continue
    }
    if (seg[0] !== 'data') {
      problemas.push(`fora de data/: ${caminho}`)
      continue
    }
    if (!caminho.endsWith('.txt')) {
      problemas.push(`o pacote aceita somente .txt: ${caminho}`)
      continue
    }

    const chave = caminho.normalize('NFC').toLowerCase()
    const anterior = vistos.get(chave)
    if (anterior !== undefined) {
      problemas.push(`colisão de nome entre ${anterior} e ${caminho}`)
      continue
    }
    vistos.set(chave, caminho)
  }

  reprova('o pacote tem caminho inválido', problemas)
}

/** Caminhos POSIX relativos de todos os arquivos regulares sob `raiz`. */
function andaPeloPacote(raiz, prefixo = '') {
  const caminhos = []
  for (const nome of readdirSync(raiz).sort()) {
    const abs = join(raiz, nome)
    const rel = prefixo ? `${prefixo}/${nome}` : nome
    if (statSync(abs).isDirectory()) caminhos.push(...andaPeloPacote(abs, rel))
    else caminhos.push(rel)
  }
  return caminhos
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { maxBuffer: 256 * 1024 * 1024 })
}

/** Blobs do commit que a política manda entregar: caminho entregue -> oid. */
function payloadEsperado(repo, commit) {
  const bruto = git(repo, ['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8')
  const esperado = new Map()
  for (const linha of bruto.split('\0')) {
    if (linha === '') continue
    const tab = linha.indexOf('\t')
    const [, , oid] = linha.slice(0, tab).split(' ')
    const caminho = linha.slice(tab + 1)
    if (classify(caminho) === 'payload-text') esperado.set(deliveryPath(caminho), oid)
  }
  return esperado
}

/**
 * Confere o pacote em `input` contra o commit de `repo`. Para na primeira
 * etapa que encontrar problema, listando tudo que aquela etapa viu. Devolve o
 * commit conferido e a contagem de payloads.
 */
export function verifyDelivery({ input, repo, commit = 'HEAD' }) {
  const pacote = resolve(input)
  const repoAbs = resolve(repo)

  if (!existsSync(pacote) || !statSync(pacote).isDirectory()) {
    throw new Error(`o pacote não existe ou não é um diretório: ${pacote}`)
  }

  const entregues = andaPeloPacote(pacote)
  if (entregues.length === 0) {
    throw new Error(`o pacote está vazio, sem nenhum arquivo em data/: ${pacote}`)
  }
  assertNomesSeguros(entregues)

  // Codificação antes de qualquer comparação: um payload em CRLF ou com BOM
  // divergiria do commit de qualquer jeito, mas o diagnóstico "o conteúdo não
  // bate" esconderia a causa, que é o arquivo ter passado por um editor.
  const conteudo = new Map()
  const deCodificacao = []
  for (const rel of entregues) {
    const bruto = readFileSync(join(pacote, ...rel.split('/')))
    try {
      const texto = normalizaParaComparar(bruto)
      if (texto !== bruto.toString('utf8')) {
        deCodificacao.push(`${rel}: BOM ou quebra CR que o pacote não deveria carregar`)
        continue
      }
      conteudo.set(rel, texto)
    } catch (erro) {
      deCodificacao.push(`${rel}: ${erro.message}`)
    }
  }
  reprova('o pacote tem payload que não é texto normalizado', deCodificacao)

  const comSegredo = []
  for (const [rel, texto] of conteudo) {
    for (const padrao of PADROES_DE_SEGREDO) {
      // A mensagem nomeia o padrão e o arquivo, nunca o valor encontrado.
      if (padrao.regex.test(texto)) comSegredo.push(`${rel}: possível ${padrao.nome}`)
    }
  }
  reprova('o pacote contém segredo', comSegredo)

  const esperado = payloadEsperado(repoAbs, commit)
  const oid = git(repoAbs, ['rev-parse', commit]).toString('utf8').trim()

  const daLista = []
  for (const rel of entregues) {
    if (!esperado.has(rel)) daLista.push(`sobrando, não é payload do commit: ${rel}`)
  }
  for (const rel of esperado.keys()) {
    if (!conteudo.has(rel)) daLista.push(`faltando no pacote: ${rel}`)
  }
  reprova('o pacote não corresponde ao commit', daLista)

  const divergentes = []
  for (const [rel, esperadoOid] of esperado) {
    const doCommit = normalizaParaComparar(git(repoAbs, ['cat-file', 'blob', esperadoOid]))
    if (conteudo.get(rel) !== doCommit) divergentes.push(`conteúdo divergente do commit: ${rel}`)
  }
  reprova('o pacote foi alterado depois de gerado', divergentes)

  return { commit: oid, arquivos: entregues.length }
}

/**
 * Execução direta detectada por URL normalizada em caixa baixa: no Windows o
 * mesmo caminho chega com caixa de drive diferente conforme o invocador.
 */
function ehExecucaoDireta() {
  if (!process.argv[1]) return false
  const invocado = pathToFileURL(resolve(process.argv[1])).href.toLowerCase()
  return invocado === import.meta.url.toLowerCase()
}

if (ehExecucaoDireta()) {
  const args = process.argv.slice(2)
  const valorDe = (nome) => {
    const indice = args.indexOf(nome)
    return indice >= 0 ? args[indice + 1] : undefined
  }
  const raizDoRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const input = valorDe('--input')
  if (!input) {
    console.error(
      'uso: node scripts/source-delivery/verify.mjs --input <dir> [--repo <dir>] [--commit <ref>]',
    )
    process.exit(2)
  }
  try {
    const resultado = verifyDelivery({
      input,
      repo: valorDe('--repo') ?? raizDoRepo,
      commit: valorDe('--commit') ?? 'HEAD',
    })
    console.log(
      `pacote íntegro: ${resultado.arquivos} arquivos conferidos contra ${resultado.commit}`,
    )
  } catch (erro) {
    console.error(erro.message)
    process.exit(1)
  }
}
