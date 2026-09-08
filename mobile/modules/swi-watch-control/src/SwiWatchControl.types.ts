// Contrato entre o módulo nativo do iPhone (recepção da HKWorkoutSession
// espelhada pelo Apple Watch) e o JavaScript. Estado da sessão, última amostra
// de BPM e um primitivo HTTP burro. Nenhum segredo, nenhum payload bruto: a
// credencial do aparelho vive no chaveiro e o JavaScript só sabe se ela existe.

export type MirroredSessionState = 'none' | 'running' | 'ended';

export interface MirroredSessionChangedEvent {
  state: MirroredSessionState;
  /** ISO-8601 do instante em que o iPhone observou a mudança. */
  changedAt: string;
}

export interface HeartRateSampleEvent {
  /** Batimentos por minuto, como entregue pelo HealthKit no relógio. */
  bpm: number;
  /** ISO-8601 do fim do intervalo da amostra, medido no relógio. */
  measuredAt: string;
}

export interface SwiWatchControlEvents {
  onMirroredSessionChanged: MirroredSessionChangedEvent;
  onHeartRateSample: HeartRateSampleEvent;
}

/**
 * Qual formato o relógio está falando. `v1` é a remessa numerada com fila e
 * confirmação; `legacy` é o formato antigo, só com batimento e sem
 * identificadores. Null enquanto nada chegou.
 *
 * Os dois existem porque o app do relógio vem dentro do `.ipa` mas se instala
 * no ritmo do sistema: há uma janela real de iPhone novo com relógio velho. O
 * contrário não existe, e por isso não é tratado.
 */
export type WatchProtocol = 'v1' | 'legacy';

export interface SwiWatchControlStatus {
  session: MirroredSessionState;
  sessionChangedAt: string | null;
  /** Ausência é null. Nunca zero. */
  lastSample: HeartRateSampleEvent | null;
  watchProtocol: WatchProtocol | null;
}

/**
 * Como o primitivo HTTP se autentica. `device` monta o cabeçalho com a
 * credencial do chaveiro sem que ela passe por aqui; `bearer` usa o token de
 * sessão do funcionário, que o JavaScript já tem por desenho.
 */
export type NativeAuth = { kind: 'device' } | { kind: 'bearer'; token: string };

/** Status e corpo crus, como vieram. Quem chama interpreta. */
export interface NativeHttpResponse {
  status: number;
  body: string;
}

/**
 * Códigos com que `request` rejeita. Os cinco primeiros vêm do Swift; o
 * último é do invólucro, quando não há módulo compilado.
 *
 * - E_URL: a URL não parseou.
 * - E_NO_CREDENTIAL: modo device sem credencial guardada; rejeita antes de
 *   tocar a rede.
 * - E_NETWORK: a conexão falhou ou não respondeu.
 * - E_KEYCHAIN: a resposta trouxe credencial e o chaveiro recusou guardar.
 * - E_CREDENTIAL_MISSING: 2xx com `storeCredential` e sem chave `credential`.
 * - E_UNSUPPORTED: Android, web, Expo Go e Jest.
 */
export type NativeRequestErrorCode =
  | 'E_URL'
  | 'E_NO_CREDENTIAL'
  | 'E_NETWORK'
  | 'E_KEYCHAIN'
  | 'E_CREDENTIAL_MISSING'
  | 'E_UNSUPPORTED';

const NATIVE_REQUEST_ERROR_CODES: ReadonlySet<string> = new Set<NativeRequestErrorCode>([
  'E_URL',
  'E_NO_CREDENTIAL',
  'E_NETWORK',
  'E_KEYCHAIN',
  'E_CREDENTIAL_MISSING',
  'E_UNSUPPORTED',
]);

/**
 * Lê o `code` de uma rejeição do `request`. Só devolve um dos códigos do
 * contrato; qualquer outra coisa (erro sem código, código de outro módulo,
 * valor que nem é erro) é null. Os serviços comparam com isto, não com string
 * solta, para uma renomeação no Swift quebrar aqui e não numa tela.
 */
export function nativeErrorCode(error: unknown): NativeRequestErrorCode | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code } = error as { code?: unknown };
  if (typeof code !== 'string' || !NATIVE_REQUEST_ERROR_CODES.has(code)) return null;
  return code as NativeRequestErrorCode;
}

/** Superfície do módulo nativo que o wrapper consome (e que os testes dublam). */
export interface WatchControlNative {
  getStatus(): SwiWatchControlStatus;
  /** Autorizacao do HealthKit no iPhone; o sistema so pergunta uma vez. */
  requestAuthorization(): Promise<boolean>;
  /**
   * Acorda o app do relogio e abre a sessao de monitoramento, via
   * HKHealthStore.startWatchApp(toHandle:). Autorizar e ativar sao acoes
   * distintas (ADR-0003). Resolve false quando o sistema recusa.
   */
  startMonitoring(): Promise<boolean>;
  /**
   * Primitivo HTTP burro. Com `storeCredential` e resposta 2xx, guarda a
   * chave `credential` do corpo no chaveiro e devolve o corpo com o valor
   * trocado por `true`; se a chave não existir, rejeita, porque um corpo com
   * segredo nunca pode subir. Rejeita com `code` em NativeRequestErrorCode.
   */
  request(
    url: string,
    method: string,
    body: string | null,
    auth: NativeAuth,
    storeCredential: boolean,
  ): Promise<NativeHttpResponse>;
  /** Ver `WatchControl.rotateInbox`. */
  rotateInbox(): string[];
  /** Só o fato de existir; o valor nunca sobe. Lê o chaveiro, síncrono. */
  hasDeviceCredential(): boolean;
  /** Revogação é do painel; o iPhone descobre pelo 401 no envio e limpa aqui. */
  clearDeviceCredential(): void;
  addListener<K extends keyof SwiWatchControlEvents>(
    event: K,
    listener: (event: SwiWatchControlEvents[K]) => void,
  ): { remove(): void };
}

export interface WatchControl {
  /** false em Android, web, Expo Go e Jest: não há módulo compilado. */
  readonly supported: boolean;
  /**
   * Fecha o arquivo durável corrente, passa a escrever no próximo, e devolve
   * as URIs `file://` dos que o Swift nunca mais vai tocar. Só depois disso é
   * seguro ler e apagar: quem rotaciona é o nativo, porque o JavaScript
   * renomeando teria uma corrida capaz de apagar um evento já confirmado ao
   * relógio. `[]` quando não suportado.
   */
  rotateInbox(): string[];
  getStatus(): SwiWatchControlStatus | null;
  /** Resolve false quando não suportado. */
  requestAuthorization(): Promise<boolean>;
  /**
   * Ativa o monitoramento no relógio. Resolve false quando não suportado ou
   * quando o sistema recusa; nunca rejeita, para a tela ter um caminho só.
   * Com a sessão espelhada já ativa não faz nada e resolve true.
   */
  startMonitoring(): Promise<boolean>;
  /** Retorna a função que cancela a inscrição. Inerte quando não suportado. */
  subscribe(listener: (status: SwiWatchControlStatus) => void): () => void;
  /**
   * Mesmo contrato do nativo. Sem suporte rejeita com `code: 'E_UNSUPPORTED'`;
   * com suporte a rejeição do Swift sobe intacta, e quem chama decide pelo
   * código (ver nativeErrorCode). A credencial do aparelho nunca aparece
   * neste contrato: o que sobe da resposta do pareamento é `true` no lugar
   * dela.
   */
  request(
    url: string,
    method: string,
    body: string | null,
    auth: NativeAuth,
    storeCredential: boolean,
  ): Promise<NativeHttpResponse>;
  /** false quando não suportado. */
  hasDeviceCredential(): boolean;
  /** Inerte quando não suportado. */
  clearDeviceCredential(): void;
}
