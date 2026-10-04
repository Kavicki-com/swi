// Local mirror of the swi-backend Report model. Siblings are isolated, so we do
// NOT import the backend types: this file is the REST contract boundary and has
// to be checked by hand whenever that contract changes.
// Mirrors services/profile/types.ts.
export type ReportStatus = 'accept' | 'pending' | 'canceled' | 'info';
export type ActivityTone = 'success' | 'warning' | 'error';

export interface ReportActivity {
  id: string;
  title: string;
  sector: string;
  progress: number; // 0-100
  tone: ActivityTone;
  avatars: string[];
  overflowCount?: number;
}

// Comentario de relatorio. O backend ja devolve pronto pra exibir: autor
// resolvido, avatar presigned e a data formatada em DD/MM/AAAA.
export interface ReportComment {
  id: string;
  body: string;
  authorName: string;
  authorAvatarUri: string;
  createdAt: string;
}

export interface Report {
  id: string;
  title: string;
  summary: string;
  status: ReportStatus;
  statusLabel: string;
  authorName: string;
  authorAvatarUri: string;
  creationDate: string;
  sector: string;
  responsibles: string[];
  details: string;
  images: string[];
  activities: ReportActivity[];
  comments: ReportComment[];
}

export interface ReportInput {
  title: string;
  summary: string;
  details: string;
  responsibles: string[];
  imageUris: string[];
}

/** O relatório como vai ao backend: as fotos já subidas, pela referência. */
export interface ReportPayload {
  title: string;
  summary: string;
  details: string;
  responsibles: string[];
  imageKeys: string[];
}

export interface ReportsBackend {
  list(): Promise<Report[]>;
  get(id: string): Promise<Report | null>;
  /**
   * Sobe uma foto e devolve a referência que o `create` aceita em `imageKeys`.
   * Passo à parte para a fila de envios subir uma vez só e repetir só o POST.
   */
  uploadImage(localUri: string): Promise<string>;
  /** `idempotencyKey`: a mesma em toda tentativa do mesmo relatório. */
  create(payload: ReportPayload, idempotencyKey?: string): Promise<Report>;
  /** Comenta num relatorio. Devolve o comentario criado, ja pronto pra lista. */
  addComment(reportId: string, body: string, idempotencyKey?: string): Promise<ReportComment>;
}
