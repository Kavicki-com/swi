// Local mirror dos models Journey/Task do swi-backend. Siblings são isolados,
// então NÃO importamos os tipos do backend: este arquivo é a fronteira do
// contrato REST e precisa ser conferido à mão quando ele mudar.
// Mirrors services/reports/types.ts.
//
// `startedAt` é ISO string no tipo de domínio; progress.ts trabalha em epoch ms
// (converte na fronteira). `images`/`responsibleAvatars` são uris já resolvidas
// (vêm presigned do backend).
//
// Tasks agora vivem sob uma WorkOrder pai: `objective` = summary da ordem;
// `images` = imageKeys da ordem (presigned); `responsible*` = responsáveis da
// ordem. Espelha `taskToDto` de swi-backend/src/journey/journey.service.ts.
export type TaskStatus = 'pending' | 'in_progress' | 'paused' | 'done';
export type JourneyState = 'idle' | 'ongoing' | 'paused';

export interface Task {
  id: string;
  title: string;
  description: string;
  objective: string;              // = summary da WorkOrder pai
  estimatedMinutes: number;
  status: TaskStatus;
  startedAt: string | null;       // ISO datetime
  accumulatedSeconds: number;
  progressPct: number;            // último snapshot persistido
  images: string[];               // uris da ORDEM pai (presigned)
  responsibleCount: number;
  responsibleNames: string[];
  responsibleAvatars: string[];   // uris (presigned)
}

export interface JourneySession {
  state: JourneyState;
  activeTaskId: string | null;
  startedAt: string | null;       // ISO datetime
  accumulatedSeconds: number;
}

/**
 * O que a fila de envios manda junto de uma ação da jornada. Sem ele a ação
 * vale na hora em que chega ao servidor e não tem proteção contra repetição.
 */
export interface JourneySend {
  /** UUID v4 do item da fila, igual em toda tentativa. */
  idempotencyKey: string;
  /** Hora do toque, ISO-8601 com fuso, com o mesmo texto em toda tentativa. */
  occurredAt: string;
}

export interface JourneyBackend {
  getJourney(): Promise<JourneySession>;
  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  startTask(taskId: string, send?: JourneySend): Promise<{ journey: JourneySession; task: Task }>;
  completeTask(taskId: string, send?: JourneySend): Promise<{ journey: JourneySession; task: Task }>;
  cancelTask(taskId: string, send?: JourneySend): Promise<{ journey: JourneySession; task: Task }>;
  pauseJourney(send?: JourneySend): Promise<JourneySession>;
  resumeJourney(send?: JourneySend): Promise<JourneySession>;
  endJourney(send?: JourneySend): Promise<JourneySession>;
  /** Sobe a foto e devolve a key dela. A fila guarda a key: a foto sobe uma vez só. */
  uploadImage(localUri: string): Promise<string>;
  /** Anexa a foto já enviada. A mesma key enviada de novo não duplica. */
  addTaskPhoto(taskId: string, imageKey: string): Promise<Task>;
}
