import type { Report, ReportActivity, ReportComment, ReportInput, ReportsBackend } from './types';
import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';

// As ATIVIDADES exigem conversão: a linha que o servidor manda chega com
// `responsibleNames` e `responsibleAvatars` e SEM `id`, enquanto a tela lê
// `activity.avatars.map(...)`. Sem `fromApi` o relatório derruba o app ao
// abrir, e nem a demo nem a suíte pegam isso, porque o mock local já devolve
// `avatars`.
//
// O painel faz a mesma conversão no mapper dele
// (swi-admin/src/services/api/reports.ts, `toReport`). `fromApi` é o par disso
// aqui.
type WireActivity = Partial<ReportActivity> & {
  responsibleNames?: string[];
  responsibleAvatars?: string[];
};
type WireReport = Omit<Partial<Report>, 'activities'> & { activities?: WireActivity[] };

// Wire → `Report`. Todo array vira [] quando ausente: o aparelho pode estar numa
// build mais nova que o servidor no ar (o deploy do backend é manual e atrasa),
// e um `report.comments` faltando derrubaria a tela do mesmo jeito.
function fromApi(dto: WireReport): Report {
  return {
    id: dto.id ?? '',
    title: dto.title ?? '',
    summary: dto.summary ?? '',
    // 'pending' é o mesmo default que o backend grava ao criar relatório — o
    // StatusTag do DS indexa por status e não aceita undefined.
    status: dto.status ?? 'pending',
    statusLabel: dto.statusLabel ?? '',
    authorName: dto.authorName ?? '',
    authorAvatarUri: dto.authorAvatarUri ?? '',
    creationDate: dto.creationDate ?? '',
    sector: dto.sector ?? '',
    responsibles: dto.responsibles ?? [],
    details: dto.details ?? '',
    images: dto.images ?? [],
    activities: (dto.activities ?? []).map((a, i) => ({
      id: a.id ?? `act-${i}`, // o servidor não manda id → sintetiza um estável por posição
      title: a.title ?? '',
      sector: a.sector ?? '',
      progress: a.progress ?? 0,
      tone: a.tone ?? 'success',
      // Equipe REAL da atividade (o backend resolve nome → foto presigned, ''
      // sem match). Servidor antigo sem o campo → sem faces, nunca face errada.
      avatars: a.responsibleAvatars ?? [],
      overflowCount: a.overflowCount,
    })),
    comments: dto.comments ?? [],
  };
}

export const apiReportsBackend: ReportsBackend = {
  async list() {
    const rows = await apiRequest<WireReport[]>('/reports', { auth: true });
    return rows.map(fromApi);
  },
  async get(id) {
    try {
      return fromApi(await apiRequest<WireReport>(`/reports/${id}`, { auth: true }));
    } catch (e) {
      if ((e as any).status === 404) return null; // 404 esperado; 500/rede propaga
      throw e;
    }
  },
  async create(input: ReportInput) {
    // Uploads em paralelo; Promise.all preserva a ordem das imagens.
    const imageKeys = await Promise.all(input.imageUris.map((uri) => uploadImage(uri)));
    // Mesma normalizacao do list/get: a resposta do POST nem sequer traz
    // `comments`, e o relatorio recem-criado vai direto pra lista em memoria.
    const criado = await apiRequest<WireReport>('/reports', {
      method: 'POST',
      body: {
        title: input.title,
        summary: input.summary,
        details: input.details,
        responsibles: input.responsibles,
        imageKeys,
      },
      auth: true,
    });
    return fromApi(criado);
  },
  /** POST /reports/:id/comments — o backend devolve o comentario ja resolvido
   *  (autor, avatar presigned, data DD/MM/AAAA), pronto pra entrar na lista. */
  async addComment(reportId: string, body: string) {
    return apiRequest<ReportComment>(`/reports/${reportId}/comments`, {
      method: 'POST',
      body: { body },
      auth: true,
    });
  },
};
