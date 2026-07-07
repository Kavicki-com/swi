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

export interface ReportComment {
  id: string;
  authorName: string;
  authorAvatarUri: string;
  text: string;
  date: string; // dd/mm/aaaa (paridade com creationDate)
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
  // Populado só no get (detail); list devolve [] (inbox não usa).
  comments: ReportComment[];
}

export interface ReportInput {
  title: string;
  summary: string;
  details: string;
  responsibles: string[];
  imageUris: string[];
}

// PATCH parcial — só os campos presentes são aplicados. Imagens ficam FORA
// da edição: as existentes chegam como URLs presigned (sem key recuperável
// no client), então re-enviá-las é impossível e enviar só as novas
// substituiria as antigas no server. O PATCH omite imagens e o backend as
// preserva intactas.
export type ReportUpdateInput = Partial<Omit<ReportInput, 'imageUris'>>;

export interface ReportsBackend {
  list(): Promise<Report[]>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
  /** null = relatório inexistente (404 no modo api). */
  update(id: string, input: ReportUpdateInput): Promise<Report | null>;
  /** null = relatório inexistente (404 no modo api). */
  addComment(id: string, text: string): Promise<ReportComment | null>;
}
