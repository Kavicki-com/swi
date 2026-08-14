// Contrato de ambiente da API do painel.
//
// A URL base é resolvida aqui, num lugar só, e os consumidores (o cliente HTTP
// e os três sockets) não repetem um fallback próprio. Um `?? 'http://localhost:3000'`
// espalhado faria o build de produção sem a variável apontar para a máquina de
// quem abriu o navegador e falhar como se o backend estivesse fora do ar,
// escondendo o erro de configuração exatamente onde ele custa mais caro.
//
// A resolução é PREGUIÇOSA e memoizada, não feita na carga do módulo. Um throw
// no topo derrubaria o bundle antes de qualquer error boundary, e a tela branca
// resultante não diz o que está errado. Assim o contrato continua valendo e a
// mensagem aparece na primeira requisição, onde dá para lê-la.

const VAR_NAME = 'VITE_API_URL'

/** Fallback de desenvolvimento: o backend Nest local. */
const DEV_FALLBACK = 'http://localhost:3000'

/** Hosts que só fazem sentido na máquina de quem desenvolve. */
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  // URL.hostname preserva os colchetes de IPv6, então é '[::1]' que chega aqui.
  '[::1]',
])

/**
 * Resolve a URL base da API.
 *
 * Pura e com o ambiente injetado para poder ser testada nos dois modos sem
 * mexer em `import.meta.env`.
 *
 * @param raw          valor cru da variável de ambiente
 * @param isProd       `true` num build de produção; `false` em dev e em teste
 * @param pageHostname host de onde a PÁGINA foi servida (`location.hostname`);
 *                     string vazia quando não há navegador, o que é tratado
 *                     como origem pública
 */
export function resolveApiUrl(
  raw: string | undefined,
  isProd: boolean,
  pageHostname: string,
): string {
  const value = raw?.trim()

  if (value === undefined || value === '') {
    if (!isProd) return DEV_FALLBACK
    throw new Error(
      `${VAR_NAME} é obrigatória no build de produção. Declare a URL pública da API (ver .env.example).`,
    )
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${VAR_NAME} não é uma URL absoluta: "${value}". Use http:// ou https://.`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `${VAR_NAME} usa o protocolo não suportado "${parsed.protocol}". Use http:// ou https://.`,
    )
  }

  // O que este guard recusa é o deploy PÚBLICO cujo bundle aponta para a
  // máquina de quem abriu o navegador. Quando a própria página
  // veio de local, essa máquina É o servidor: é o caso do pacote de duplo
  // clique, em que Nginx serve o painel em http://localhost:5173 e a API sobe
  // em http://localhost:3000, no mesmo Docker. Recusar ali derrubaria o painel
  // do cliente sem haver nada a proteger.
  //
  // Origem desconhecida (sem `window`) chega como string vazia e cai no lado
  // estrito, porque o desconhecido não pode virar permissão.
  if (isProd && LOCAL_HOSTS.has(parsed.hostname) && !LOCAL_HOSTS.has(pageHostname)) {
    throw new Error(
      `${VAR_NAME} aponta para a máquina local ("${parsed.hostname}") num build de produção servido de "${pageHostname || 'origem desconhecida'}". Use o endereço público da API. Em desenvolvimento, e quando o próprio painel é servido de localhost, localhost segue permitido.`,
    )
  }

  // Sem barra final: os chamadores concatenam caminhos que já começam com '/'.
  return value.replace(/\/+$/, '')
}

let cached: string | undefined

/** URL base da API, resolvida na primeira chamada e memoizada. */
export function getApiUrl(): string {
  cached ??= resolveApiUrl(
    import.meta.env.VITE_API_URL as string | undefined,
    import.meta.env.PROD,
    typeof window === 'undefined' ? '' : window.location.hostname,
  )
  return cached
}
