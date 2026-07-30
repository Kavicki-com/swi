// Local mirror of the swi-backend Report model. Siblings are isolated, so we do
// NOT import the backend Schema type; after deploy, `ampx generate
// graphql-client-code --out` can replace this with generated types (Phase 6).
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

export interface ReportsBackend {
  list(): Promise<Report[]>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
  /** Comenta num relatorio. Devolve o comentario criado, ja pronto pra lista. */
  addComment(reportId: string, body: string): Promise<ReportComment>;
}
