import { Alert, Linking } from 'react-native';
import { isRelaxedEnv, RUNTIME_ENV, type RuntimeEnv } from '../featureFlags';
import { getApiUrl } from '../../services/auth/apiConfig';
import { errorMessage } from '../errors/errorMessage';

export interface OpcoesMidiaConfiavel {
  /** Origem da API; a mídia servida por ela é confiável por definição. */
  apiUrl: string;
  /** CSV de origens HTTPS exatas (EXPO_PUBLIC_MEDIA_ORIGINS). */
  origensExtras: string | undefined;
  env: RuntimeEnv;
}

/**
 * Origem canônica de uma URL, ou undefined se o valor não for URL absoluta.
 *
 * Comparar ORIGEM, e não host nem prefixo de string, é o que derruba o
 * "subdomínio enganoso": `https://api.exemplo.test.invasor.test` tem origem
 * diferente de `https://api.exemplo.test`, enquanto qualquer checagem por
 * `includes` ou `endsWith` deixaria passar.
 */
function origemDe(valor: string): string | undefined {
  try {
    return new URL(valor).origin;
  } catch {
    return undefined;
  }
}

function origensPermitidas(opcoes: OpcoesMidiaConfiavel): string[] {
  const lista = [origemDe(opcoes.apiUrl)];
  for (const parte of (opcoes.origensExtras ?? '').split(',')) {
    const limpo = parte.trim();
    if (limpo !== '') lista.push(origemDe(limpo));
  }
  return lista.filter((o): o is string => o !== undefined);
}

/**
 * Valida uma URL de mídia vinda do backend antes de qualquer abertura.
 *
 * O valor chega dentro do JSON da API e vai direto para o navegador do
 * aparelho, o que o torna dado de fora: basta um registro adulterado no banco,
 * ou uma resposta forjada, para o aplicativo abrir o que mandarem. As duas
 * telas de exame chamavam `Linking.openURL(exam.fileUrl)` sem olhar o valor.
 *
 * Lança com mensagem legível em vez de devolver null: quem chama precisa
 * mostrar o motivo ao usuário, e um retorno vazio viraria uma tela que não faz
 * nada quando se toca nela.
 */
export function resolveTrustedMediaUrl(
  bruta: string | undefined,
  opcoes: OpcoesMidiaConfiavel,
): string {
  const valor = bruta?.trim();
  if (!valor) {
    throw new Error('O arquivo deste exame não tem endereço para abrir.');
  }

  let parsed: URL;
  try {
    parsed = new URL(valor);
  } catch {
    // Cai aqui também para `javascript:alert(1)` sem `//`, e para caminhos
    // relativos, que não têm origem com que comparar.
    throw new Error('O endereço do arquivo é inválido e não será aberto.');
  }

  // Credencial embutida vaza em histórico e log, e ainda disfarça o host real:
  // em `https://api.exemplo.test@invasor.test` o host é invasor.test, e o olho
  // lê api.exemplo.test.
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('O endereço do arquivo traz credenciais embutidas e não será aberto.');
  }

  // Em release só HTTPS. Em dev a stack local serve mídia do MinIO por http, e
  // sem esta ressalva a tela de exames pararia de abrir na máquina de quem
  // desenvolve. A checagem de origem abaixo continua valendo nos dois casos:
  // relaxar o esquema é uma conveniência, abrir qualquer endereço é outra
  // coisa.
  if (!isRelaxedEnv(opcoes.env) && parsed.protocol !== 'https:') {
    throw new Error('O arquivo deste exame não é servido por HTTPS e não será aberto.');
  }

  if (!origensPermitidas(opcoes).includes(parsed.origin)) {
    throw new Error(
      `O arquivo vem de uma origem não autorizada (${parsed.origin}) e não será aberto.`,
    );
  }

  return valor;
}

/**
 * Abre a mídia, ou lança a mensagem que a tela deve mostrar. Nunca chama o
 * `Linking` com URL que não passou pela validação acima.
 */
export async function openTrustedMediaUrl(bruta: string | undefined): Promise<void> {
  const url = resolveTrustedMediaUrl(bruta, {
    apiUrl: getApiUrl(),
    // Literal, não acesso dinâmico: o Babel do Expo substitui a expressão
    // inteira pelo valor no bundle, e `process.env[nome]` resolveria para
    // undefined em produção.
    origensExtras: process.env.EXPO_PUBLIC_MEDIA_ORIGINS,
    env: RUNTIME_ENV,
  });
  await Linking.openURL(url);
}

/**
 * O que as telas de exame chamam. Recusar em silêncio seria pior que abrir:
 * o usuário tocaria no card e nada aconteceria, sem nunca saber por quê.
 */
export async function abrirMidiaOuAvisar(
  bruta: string | undefined,
  descricao: string,
): Promise<void> {
  try {
    await openTrustedMediaUrl(bruta);
  } catch (e) {
    Alert.alert('Erro', errorMessage(e, `Não foi possível abrir ${descricao}.`));
  }
}
