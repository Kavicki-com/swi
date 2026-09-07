import { readToken as readSessionToken } from '../api/http';
import { getApiUrl } from '../auth/apiConfig';
import { nativeErrorCode, watchControl, type WatchControl } from '../../modules/swi-watch-control';

// Conclusão do pareamento do iPhone. O administrador cria o convite no painel
// e dita ao funcionário o identificador e um código de seis dígitos; aqui o
// funcionário autenticado conclui. O backend responde com a credencial do
// aparelho, e ela NUNCA chega a este arquivo: o pedido vai pelo módulo nativo
// com `storeCredential` ligado, o Swift guarda o valor no chaveiro e sobe o
// corpo com `true` no lugar. O JavaScript só sabe que pareou.

const COMPLETE_PATH = '/telemetry/v1/devices/enrollments/complete';

export type EnrollmentFailureReason =
  | 'unsupported'
  | 'unauthorized'
  | 'invalid_code'
  | 'expired'
  | 'already_used'
  | 'keychain'
  | 'network'
  | 'unexpected';

export interface EnrollmentFailure {
  paired: false;
  reason: EnrollmentFailureReason;
}

export type EnrollmentResult = { paired: true } | EnrollmentFailure;

export interface EnrollmentDeps {
  control?: WatchControl;
  readToken?: () => Promise<string | null>;
  apiUrl?: () => string;
  /**
   * Rótulo do aparelho para o painel (o administrador reconhece qual iPhone
   * revogar). Sem `expo-device` no projeto, o padrão é não informar.
   */
  deviceModel?: () => string | null;
}

// O backend responde 400 para as três recusas (device-auth.service.ts,
// completeEnrollment), e só a mensagem distingue. Os trechos são estáveis por
// serem a resposta ao funcionário; se mudarem lá, tudo cai em `invalid_code`,
// que é o mais conservador: a tela pede para conferir o código.
function reasonForBadRequest(body: string): EnrollmentFailureReason {
  const message = messageOf(body).toLowerCase();
  if (message.includes('expirado')) return 'expired';
  if (message.includes('utilizado')) return 'already_used';
  return 'invalid_code';
}

// O Nest devolve `message` como string, ou como lista quando é o validador.
// Corpo que não é JSON conta como sem mensagem, nunca como exceção.
function messageOf(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return '';
    const { message } = parsed as { message?: unknown };
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join(', ');
    return '';
  } catch {
    return '';
  }
}

function reasonForStatus(status: number, body: string): EnrollmentFailureReason {
  if (status === 400) return reasonForBadRequest(body);
  if (status === 401) return 'unauthorized';
  return 'unexpected';
}

function reasonForRejection(error: unknown): EnrollmentFailureReason {
  switch (nativeErrorCode(error)) {
    case 'E_KEYCHAIN':
      return 'keychain';
    case 'E_NETWORK':
      return 'network';
    case 'E_UNSUPPORTED':
      return 'unsupported';
    // E_URL e E_NO_CREDENTIAL não acontecem em modo bearer com a URL da API;
    // E_CREDENTIAL_MISSING é 2xx sem credencial, ou seja, backend fora do
    // contrato. Nenhum deles é algo que o funcionário resolva repetindo.
    default:
      return 'unexpected';
  }
}

// Um chaveiro que nem responde é tratado como vazio: o pior caso é o
// funcionário parear de novo, e o backend revoga o aparelho anterior.
function credentialStored(control: WatchControl): boolean {
  try {
    return control.hasDeviceCredential();
  } catch {
    return false;
  }
}

/**
 * Nunca rejeita: todo desfecho vira um motivo que a tela sabe mostrar.
 *
 * Antes de qualquer `paired: false` que não seja `unsupported`, consulta o
 * chaveiro. Há um caminho raro em que o Swift guardou a credencial e a
 * resposta não chegou ao JavaScript (a ponte caiu, o app foi suspenso). Nesse
 * caso o aparelho ESTÁ pareado, e o backend já consumiu o convite: dizer
 * "tente de novo" mandaria o funcionário atrás de um convite novo à toa.
 */
export async function completeEnrollment(
  enrollmentId: string,
  code: string,
  deps: EnrollmentDeps = {},
): Promise<EnrollmentResult> {
  const {
    control = watchControl,
    readToken = readSessionToken,
    apiUrl = getApiUrl,
    deviceModel = () => null,
  } = deps;

  if (!control.supported) return { paired: false, reason: 'unsupported' };

  const failure = (reason: EnrollmentFailureReason): EnrollmentResult => {
    if (credentialStored(control)) {
      console.warn(
        `[deviceEnrollment] pareamento confirmado pelo chaveiro, não pela resposta (motivo descartado: ${reason})`,
      );
      return { paired: true };
    }
    return { paired: false, reason };
  };

  let token: string | null;
  try {
    token = await readToken();
  } catch {
    token = null;
  }
  if (!token) return failure('unauthorized');

  const model = deviceModel();
  const payload: { enrollmentId: string; code: string; model?: string } = { enrollmentId, code };
  if (model) payload.model = model;

  let response;
  try {
    response = await control.request(
      `${apiUrl()}${COMPLETE_PATH}`,
      'POST',
      JSON.stringify(payload),
      { kind: 'bearer', token },
      true,
    );
  } catch (error) {
    return failure(reasonForRejection(error));
  }

  if (response.status >= 200 && response.status < 300) return { paired: true };
  return failure(reasonForStatus(response.status, response.body));
}
