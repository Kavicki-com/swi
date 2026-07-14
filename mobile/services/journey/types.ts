// Local mirror dos models Journey/Task do swi-backend. Siblings são isolados,
// então NÃO importamos o Schema do backend; após deploy, `ampx generate
// graphql-client-code --out` pode substituir por tipos gerados (Phase 6).
// Mirrors services/reports/types.ts.
//
// `startedAt` é ISO string no tipo de domínio; progress.ts trabalha em epoch ms
// (converte na fronteira). `images`/`responsibleAvatars` são uris resolvidas (de
// keys do S3 no amplify).
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
  images: string[];               // uris da ORDEM pai (resolvidas de keys no amplify)
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

export interface JourneyBackend {
  getJourney(): Promise<JourneySession>;
  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  startTask(taskId: string): Promise<{ journey: JourneySession; task: Task }>;
  completeTask(taskId: string): Promise<{ journey: JourneySession; task: Task }>;
  cancelTask(taskId: string): Promise<{ journey: JourneySession; task: Task }>;
  pauseJourney(): Promise<JourneySession>;
  resumeJourney(): Promise<JourneySession>;
  endJourney(): Promise<JourneySession>;
  addTaskPhoto(taskId: string, uri: string): Promise<Task>;
}
