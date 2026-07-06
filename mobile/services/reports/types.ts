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
}

export interface ReportInput {
  title: string;
  summary: string;
  details: string;
  responsibles: string[];
  imageUris: string[];
}

export interface ReportsPage {
  items: Report[];
  total: number;
}

export interface ReportsBackend {
  list(page: number, limit: number): Promise<ReportsPage>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
}
