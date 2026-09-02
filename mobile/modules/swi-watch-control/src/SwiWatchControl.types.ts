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
  addListener<K extends keyof SwiWatchControlEvents>(
    event: K,
    listener: (event: SwiWatchControlEvents[K]) => void,
  ): { remove(): void };
}

export interface WatchControl {
  /** false em Android, web, Expo Go e Jest: não há módulo compilado. */
  readonly supported: boolean;
  getStatus(): SwiWatchControlStatus | null;
  /** Retorna a função que cancela a inscrição. Inerte quando não suportado. */
  subscribe(listener: (status: SwiWatchControlStatus) => void): () => void;
}
