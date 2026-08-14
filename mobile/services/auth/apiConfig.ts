import {
  isRelaxedEnv,
  RUNTIME_ENV,
  type RuntimeEnv,
} from '../../lib/featureFlags';

const VAR_NAME = 'EXPO_PUBLIC_API_URL';

/** Fallback de desenvolvimento. Emulador Android usa 10.0.2.2; device físico, o IP da LAN. */
const DEV_FALLBACK = 'http://localhost:3000';

/** Hosts que só fazem sentido na máquina de quem desenvolve. */
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  // URL.hostname preserva os colchetes de IPv6, então é '[::1]' que chega aqui.
  '[::1]',
  // Alias do emulador Android para o host.
  '10.0.2.2',
  // Alias do emulador Genymotion para o host.
  '10.0.3.2',
]);

/**
 * Resolve a URL base da API a partir da variável de ambiente.
 *
 * Fora de dev e teste a variável é obrigatória e não pode apontar para a
 * máquina local: um build de release com localhost falha em silêncio no device
 * do usuário, e o fallback antigo escondia exatamente esse erro.
 */
export function resolveApiUrl(
  raw: string | undefined,
  env: RuntimeEnv,
): string {
  const value = raw?.trim();

  if (value === undefined || value === '') {
    if (isRelaxedEnv(env)) return DEV_FALLBACK;
    throw new Error(
      `${VAR_NAME} é obrigatória fora de desenvolvimento. Declare a URL da API no perfil de build.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `${VAR_NAME} não é uma URL absoluta: "${value}". Use http:// ou https://.`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `${VAR_NAME} usa o protocolo não suportado "${parsed.protocol}". Use http:// ou https://.`,
    );
  }

  if (!isRelaxedEnv(env) && LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `${VAR_NAME} aponta para a máquina local ("${parsed.hostname}"), o que não funciona num build de release. Use o endereço público da API. Em desenvolvimento, localhost segue permitido.`,
    );
  }

  // Depois do host local de propósito: um `http://127.0.0.1` em release viola as
  // duas regras, e "aponta para a máquina local" é o diagnóstico acionável, já
  // que diz o que a pessoa esqueceu de configurar.
  //
  // Em release o token de sessão viaja em todo pedido, e sobre http ele vai em
  // texto claro para quem estiver no caminho. O host nem precisa parecer
  // suspeito: "http://api.kavicki.com" passava na checagem acima e seguia sem
  // cifra. Em dev e sob a suíte http continua valendo, senão a stack local, que
  // não tem certificado, deixaria de ser alcançável.
  if (!isRelaxedEnv(env) && parsed.protocol !== 'https:') {
    throw new Error(
      `${VAR_NAME} precisa usar HTTPS num build de release ("${value}" usa ${parsed.protocol.replace(':', '')}). Em desenvolvimento, http segue permitido.`,
    );
  }

  // Sem barra final: os chamadores concatenam caminhos que já começam com '/'.
  return value.replace(/\/+$/, '');
}

let cached: string | undefined;

/**
 * URL base da API, resolvida na primeira chamada e memoizada.
 *
 * Preguiçosa de propósito: resolver na carga do módulo faria um ambiente mal
 * configurado derrubar o bundle inteiro antes de qualquer error boundary, e
 * quebraria a renderização estática do `expo export`, que executa os módulos
 * sem as variáveis do perfil de build. Assim o contrato continua valendo, mas
 * o erro aparece na primeira requisição, com a mensagem no lugar certo.
 */
export function getApiUrl(): string {
  cached ??= resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, RUNTIME_ENV);
  return cached;
}
