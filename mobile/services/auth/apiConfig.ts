import { RUNTIME_ENV, type RuntimeEnv } from '../../lib/featureFlags';

const VAR_NAME = 'EXPO_PUBLIC_API_URL';

/** Fallback de desenvolvimento. Emulador Android usa 10.0.2.2; device físico, o IP da LAN. */
const DEV_FALLBACK = 'http://localhost:3000';

/** Hosts que só fazem sentido na máquina de quem desenvolve. */
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  // Alias do emulador Android para o host.
  '10.0.2.2',
  // Alias do emulador Genymotion para o host.
  '10.0.3.2',
]);

function isRelaxedEnv(env: RuntimeEnv): boolean {
  return env.isDev || env.isTest || env.allowDemoMocks;
}

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
