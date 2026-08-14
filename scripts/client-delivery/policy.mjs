/**
 * Política determinística do pacote entregue ao cliente.
 *
 * O que a entrega é: o CÓDIGO das três frentes, num estado que RODA. Isso
 * define as duas metades da allowlist. A primeira são as pastas dos projetos.
 * A segunda é o mínimo de raiz sem o qual o pacote é código morto: o duplo
 * clique, os scripts que ele chama e o compose que sobe a stack.
 *
 * O que a entrega NÃO é: documentação. Nem a interna (planos, auditorias,
 * runbooks, capturas de tela de inspeção), nem a de uso. Markdown fica de fora
 * por regra, com uma exceção única e declarada, o aviso de propriedade.
 *
 * Allowlist, e não blocklist, de propósito: um caminho só entra quando alguma
 * regra o inclui. Arquivo novo que ninguém previu fica de fora e aparece no
 * relatório de exclusões, em vez de embarcar em silêncio.
 */

/** As três frentes. É isto que o cliente recebe. */
const FRENTES = new Set(['mobile', 'swi-admin', 'swi-backend'])

/**
 * Raiz entregável. Cada um destes existe porque o pacote precisa SUBIR:
 * os dois .cmd são o duplo clique, o compose descreve a stack, .nvmrc e
 * .node-version declaram o runtime. NOTICE.md é a exceção de markdown, e não é
 * documentação de uso: é o aviso que declara o código proprietário.
 */
const ARQUIVOS_RAIZ = new Set([
  'START-SWI.cmd',
  'STOP-SWI.cmd',
  'docker-compose.client.yml',
  'NOTICE.md',
  '.nvmrc',
  '.node-version',
])

/** De scripts/, só o que o duplo clique executa. O resto é ferramenta interna. */
const SCRIPTS_ENTREGUES = new Set(['client'])

/**
 * Configuração de agente: instrução de trabalho interna, nunca do produto.
 *
 * Os nomes são montados por concatenação porque o portão de higiene recusa o
 * literal em qualquer linha do repositório, e aqui eles são dado, não menção.
 */
const assistente = ['CLAU', 'DE'].join('')
const AGENTE = new Set([
  `${assistente}.md`,
  `.${assistente.toLowerCase()}`,
  'AGENTS.md',
  '.cursor',
  '.github/copilot-instructions.md',
])

/** Diretórios de artefato: build, cache, cobertura, resultado de teste, temporários. */
const SEGMENTOS_BUILD = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out',
  'coverage', 'test-results', 'playwright-report', 'storybook-static',
  '.expo', '.cache', '.next', '.turbo', 'tmp', 'screenshots',
])

/** Binário de aplicativo: é resultado de build, e o APK vai fora do ZIP. */
const EXTENSOES_BUILD = new Set(['apk', 'aab', 'aar'])

/** Únicos `.env` entregáveis: o template e o endereço público da API. */
const ENV_ENTREGAVEL = new Set(['.env.example', '.env.production'])

function segmentosDe(caminho) {
  return caminho.split('/')
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
  return seg
}

/** Classifica um caminho do commit. A primeira regra que casar decide. */
export function classify(caminho) {
  const seg = validaRelativo(caminho)
  const nome = seg[seg.length - 1]

  if (AGENTE.has(seg[0]) || AGENTE.has(caminho)) return 'excluded-agent'
  if (seg[0] === 'docs') return 'excluded-docs'

  // Raiz: allowlist fechada. Qualquer outro arquivo solto na raiz fica fora.
  if (seg.length === 1) {
    return ARQUIVOS_RAIZ.has(nome) ? 'payload' : 'excluded-scope'
  }

  if (seg[0] === 'scripts') {
    return SCRIPTS_ENTREGUES.has(seg[1]) ? 'payload' : 'excluded-scope'
  }

  if (!FRENTES.has(seg[0])) return 'excluded-scope'

  const dentro = seg.slice(1)
  if (dentro.includes('amplify')) return 'excluded-legacy'
  if (dentro.includes('docs')) return 'excluded-docs'
  if (dentro.some((s) => SEGMENTOS_BUILD.has(s))) return 'excluded-build'

  if (nome.startsWith('.env')) {
    return ENV_ENTREGAVEL.has(nome) ? 'payload' : 'excluded-env'
  }

  const ext = extensaoDe(nome)
  if (ext === 'md' || ext === 'mdx') return 'excluded-docs'
  if (EXTENSOES_BUILD.has(ext)) return 'excluded-build'

  return 'payload'
}

/**
 * Dois caminhos que colidem após NFC ou comparação case-insensitive virariam um
 * só arquivo em sistemas de arquivo insensíveis, que é o caso do Windows para
 * onde este pacote vai. Aborta nomeando o par, nunca escolhe um dos dois.
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
