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
  // Versao OCC do registro (backend Report.version): a tela de edicao a carrega
  // e devolve em update() como baseVersion pra detectar edicao concorrente.
  version: number;
}

export interface ReportInput {
  title: string;
  summary: string;
  details: string;
  responsibles: string[];
  imageUris: string[];
}

// Edicao restrita POR CONSTRUCAO aos campos que o worker preenche na criacao:
// status/statusLabel sao veredito do ciclo de revisao (ato de ADMIN no painel)
// e nao existem aqui de proposito. Espelha WORKER_EDITABLE_FIELDS do backend.
export interface ReportUpdateInput {
  title?: string;
  summary?: string;
  details?: string;
  responsibles?: string[];
  /** Versao que a tela carregou. Desatualizada, o backend responde 409. */
  baseVersion: number;
}

// Erros tipados do contrato de edicao/exclusao. `Object.setPrototypeOf` porque
// o transform do Babel quebra `instanceof` em subclasse de Error sem ele.
/** 403: quem esta logado nao e o autor (admin edita pelo painel, nao pelo app). */
export class ReportPermissionError extends Error {
  constructor(message?: string) {
    super(message ?? 'Apenas o autor pode alterar o relatório');
    this.name = 'ReportPermissionError';
    Object.setPrototypeOf(this, ReportPermissionError.prototype);
  }
}

/** 409: alguem editou o relatorio depois que a tela carregou (OCC). */
export class ReportVersionConflictError extends Error {
  constructor(message?: string) {
    super(message ?? 'O relatório foi alterado por outra pessoa. Recarregue e tente de novo.');
    this.name = 'ReportVersionConflictError';
    Object.setPrototypeOf(this, ReportVersionConflictError.prototype);
  }
}

export interface ReportsBackend {
  list(): Promise<Report[]>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
  /**
   * Edita um relatorio proprio. Rejeita com ReportPermissionError (403) ou
   * ReportVersionConflictError (409); devolve o relatorio ja atualizado.
   */
  update(id: string, input: ReportUpdateInput): Promise<Report>;
  /** Exclui um relatorio proprio. Rejeita com ReportPermissionError (403). */
  remove(id: string): Promise<void>;
  /** Comenta num relatorio. Devolve o comentario criado, ja pronto pra lista. */
  addComment(reportId: string, body: string): Promise<ReportComment>;
}
