import { describeApiTarget, resolveApiUrl } from './apiConfig'

// `true` = build de produção; `false` = dev/teste, onde localhost é legítimo.
const PROD = true
const DEV = false

// De onde a PÁGINA foi servida. É o que separa um deploy público apontando para
// a máquina do visitante (recusado) de um stack rodando inteiro na máquina de
// quem abriu o navegador (o pacote de duplo clique entregue ao cliente).
const PAGINA_PUBLICA = 'painel.kavicki.com'
const PAGINA_LOCAL = 'localhost'

describe('resolveApiUrl', () => {
  it('exige a variável em produção', () => {
    expect(() => resolveApiUrl(undefined, PROD, PAGINA_PUBLICA)).toThrow(/VITE_API_URL/)
    expect(() => resolveApiUrl('', PROD, PAGINA_PUBLICA)).toThrow(/VITE_API_URL/)
    expect(() => resolveApiUrl('   ', PROD, PAGINA_PUBLICA)).toThrow(/VITE_API_URL/)
  })

  it('recusa a máquina local em produção quando a página é pública', () => {
    expect(() => resolveApiUrl('http://localhost:3000', PROD, PAGINA_PUBLICA)).toThrow(/produção/)
    expect(() => resolveApiUrl('http://127.0.0.1:3000', PROD, PAGINA_PUBLICA)).toThrow(/produção/)
  })

  // URL.hostname devolve '[::1]' COM colchetes. Comparar contra '::1' cru nunca
  // casa, e o loopback IPv6 passaria direto pelo guard.
  it('recusa o loopback IPv6 com colchetes', () => {
    expect(() => resolveApiUrl('http://[::1]:3000', PROD, PAGINA_PUBLICA)).toThrow(/produção/)
  })

  // O stack de duplo clique do cliente: build de produção servido por Nginx em
  // http://localhost:5173 conversando com a API em http://localhost:3000. Aqui
  // a máquina do visitante É o servidor, então não há nada a proteger. Sem esta
  // exceção o painel do cliente morre na primeira requisição.
  it('aceita a máquina local em produção quando a própria página veio de local', () => {
    expect(resolveApiUrl('http://localhost:3000', PROD, PAGINA_LOCAL)).toBe('http://localhost:3000')
    expect(resolveApiUrl('http://localhost:3000', PROD, '127.0.0.1')).toBe('http://localhost:3000')
    // location.hostname preserva os colchetes do IPv6 nos dois lados.
    expect(resolveApiUrl('http://[::1]:3000', PROD, '[::1]')).toBe('http://[::1]:3000')
  })

  // A recíproca não vale: página local apontando para a API pública é alguém
  // rodando o painel na própria máquina contra api.kavicki.com. Legítimo.
  it('aceita API pública mesmo com a página servida de local', () => {
    expect(resolveApiUrl('https://api.kavicki.com', PROD, PAGINA_LOCAL)).toBe('https://api.kavicki.com')
  })

  it('recusa URL relativa ou protocolo não suportado', () => {
    expect(() => resolveApiUrl('api.kavicki.com', PROD, PAGINA_PUBLICA)).toThrow(/URL absoluta/)
    expect(() => resolveApiUrl('ftp://api.kavicki.com', PROD, PAGINA_PUBLICA)).toThrow(/protocolo/)
  })

  it('aceita o endereço público e remove a barra final', () => {
    expect(resolveApiUrl('https://api.kavicki.com', PROD, PAGINA_PUBLICA)).toBe('https://api.kavicki.com')
    expect(resolveApiUrl('https://api.kavicki.com/', PROD, PAGINA_PUBLICA)).toBe('https://api.kavicki.com')
    expect(resolveApiUrl('https://api.kavicki.com///', PROD, PAGINA_PUBLICA)).toBe('https://api.kavicki.com')
  })

  // Origem desconhecida (sem `window`, como num render fora do navegador) cai no
  // lado estrito de propósito: o desconhecido não pode virar permissão.
  it('trata origem desconhecida como pública', () => {
    expect(() => resolveApiUrl('http://localhost:3000', PROD, '')).toThrow(/produção/)
  })

  it('em dev aceita localhost e cai no default quando a variável falta', () => {
    expect(resolveApiUrl('http://localhost:3000', DEV, PAGINA_PUBLICA)).toBe('http://localhost:3000')
    expect(resolveApiUrl(undefined, DEV, PAGINA_PUBLICA)).toBe('http://localhost:3000')
  })
})

// O painel e o aplicativo podem estar apontando para backends DIFERENTES: o
// stack local que o pacote sobe e a API pública. Quando isso acontece, um não
// mostra o dado do outro, e sem nada na tela dizendo de onde o dado vem a
// conclusão natural é que o sistema está quebrado. Esta função é o que alimenta
// o selo que responde essa pergunta.
describe('describeApiTarget', () => {
  it('chama de ambiente local o que roda na máquina de quem abriu', () => {
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      expect(describeApiTarget(url).isLocal).toBe(true)
      expect(describeApiTarget(url).label).toBe('Ambiente local')
    }
  })

  it('nomeia o host quando a API é remota, porque é o que distingue um ambiente do outro', () => {
    const alvo = describeApiTarget('https://api.kavicki.com')
    expect(alvo.isLocal).toBe(false)
    expect(alvo.host).toBe('api.kavicki.com')
    expect(alvo.label).toBe('api.kavicki.com')
  })

  it('ignora porta e caminho no rótulo: o que identifica o ambiente é o host', () => {
    expect(describeApiTarget('https://api.kavicki.com:8443/v1').label).toBe('api.kavicki.com')
  })

  it('URL inválida não derruba a tela, e o rótulo diz que o alvo é desconhecido', () => {
    expect(describeApiTarget('nao-e-url').label).toBe('API desconhecida')
    expect(describeApiTarget('').isLocal).toBe(false)
  })
})
