// Contrato entre o módulo nativo do iPhone (recepção da HKWorkoutSession
// espelhada pelo Apple Watch) e o JavaScript. Task 1 do piloto: só estado da
// sessão e última amostra de BPM. Nenhum segredo, nenhum payload bruto.

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

export interface SwiWatchControlStatus {
  session: MirroredSessionState;
  sessionChangedAt: string | null;
  /** Ausência é null. Nunca zero. */
  lastSample: HeartRateSampleEvent | null;
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
  addListener<K extends keyof SwiWatchControlEvents>(
    event: K,
    listener: (event: SwiWatchControlEvents[K]) => void,
  ): { remove(): void };
}

export interface WatchControl {
  /** false em Android, web, Expo Go e Jest: não há módulo compilado. */
  readonly supported: boolean;
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
}
